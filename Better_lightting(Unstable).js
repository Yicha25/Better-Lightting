// ==UserScript==
// @name         Better-Lighting (Smooth Edges)
// @namespace    https://github.com/Yicha25/Better-Lighting/
// @version      0.1.8
// @description  Adds Screen Space Reflections (SSR) with smooth edge fading
// @match        https://www.geo-fs.com/geofs.php?v=*
// @match        https://*.geo-fs.com/geofs.php*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    console.log("Installing Better Lighting by Yicha (Smooth Edges)");

    setTimeout(function() {
        try {
            // --- Configuration & Global State ---
            const initialStrength = 0.5;
            
            if (typeof geofs.ssr === 'undefined') {
                geofs.ssr = {
                    strength: initialStrength, 
                    maxDistance: 2500.0,
                    isEnabled: true
                };
            }
            
            // Define the update function 
            geofs.ssr.updateStrength = function(value) {
                geofs.ssr.strength = parseFloat(value) / 100.0;
                geofs.ssr.updateUniforms(); 
            };
            
            // Safety check for model
            if (!geofs.aircraft || !geofs.aircraft.instance || !geofs.aircraft.instance.object3d.model) {
                 // Retry logic could go here, but throwing error as per original request structure
                 console.log("Aircraft not ready, waiting...");
                 return; // Prevent crash
            }
            const planeModel = geofs.aircraft.instance.object3d.model._model;

            // --- 1. GLSL Shader Code (Updated with Edge Smoothing) ---
            const shaderCode = `
                #extension GL_OES_standard_derivatives : enable
                uniform sampler2D depthTexture;
                uniform sampler2D colorTexture;
                uniform float strength;
                uniform float maxDistance;
                uniform bool isEnabled;

                varying vec2 v_textureCoordinates;

                // --- Helper Functions ---
                vec3 getPosition(vec2 uv, float depth) {
                    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
                    vec4 viewPos = czm_inverseProjection * ndc;
                    return viewPos.xyz / viewPos.w;
                }

                vec3 getNormal(vec3 pos) {
                    return normalize(cross(dFdx(pos), dFdy(pos)));
                }

                void main(void) {
                    if (!isEnabled) {
                        gl_FragColor = texture2D(colorTexture, v_textureCoordinates);
                        return;
                    }

                    vec4 color = texture2D(colorTexture, v_textureCoordinates);
                    float depth = czm_readDepth(depthTexture, v_textureCoordinates);
                    
                    if (depth >= 1.0) {
                        gl_FragColor = color;
                        return;
                    }

                    vec3 pos = getPosition(v_textureCoordinates, depth);
                    vec3 normal = getNormal(pos);
                    vec3 viewDir = normalize(pos); 
                    vec3 rayDir = reflect(viewDir, normal); 
                    
                    // --- ATTENUATION & FADING ---
                    float attenuation = 1.0;
                    float viewDistance = length(pos);
                    attenuation *= clamp(1.0 - (viewDistance / 300.0), 0.0, 1.0); 

                    if (attenuation < 0.05) {
                        gl_FragColor = color;
                        return;
                    }

                    // Ray Marching
                    vec3 currentPos = pos;
                    float rayLength = maxDistance * 0.01;
                    float hit = 0.0;
                    vec2 hitUV = vec2(0.0);
                    float iterations = 0.0;

                    for(int i = 0; i < 30; i++) {
                        currentPos += rayDir * rayLength;
                        rayLength += maxDistance * 0.01;
                        iterations += 1.0;
                        
                        vec4 clip = czm_projection * vec4(currentPos, 1.0);
                        vec3 ndc = clip.xyz / clip.w;
                        vec2 testUV = ndc.xy * 0.5 + 0.5;

                        // Basic bounds check
                        if(testUV.x < 0.0 || testUV.x > 1.0 || testUV.y < 0.0 || testUV.y > 1.0 || rayLength > maxDistance) break;

                        float testDepth = czm_readDepth(depthTexture, testUV);
                        vec3 testScenePos = getPosition(testUV, testDepth);

                        if(currentPos.z > testScenePos.z) {
                            hit = 1.0;
                            hitUV = testUV;
                            break;
                        }
                    }

                    // --- FINAL MIX WITH SMOOTH EDGES ---
                    if (hit > 0.5) {
                        vec4 reflectColor = texture2D(colorTexture, hitUV);
                        
                        // 1. Screen Edge Fading (Vignette for reflection)
                        // Calculates distance from center (0.5, 0.5) and fades out as it approaches 0.0 or 1.0
                        vec2 dCoords = smoothstep(0.2, 0.6, abs(vec2(0.5, 0.5) - hitUV.xy));
                        float screenEdgeFactor = clamp(1.0 - (dCoords.x + dCoords.y), 0.0, 1.0);
                        
                        // 2. Reflection distance fading
                        // Fades the reflection based on how far the ray traveled
                        float reflectionDistanceFactor = 1.0 - clamp(iterations / 30.0, 0.0, 1.0);

                        // Combine factors
                        float finalAlpha = strength * attenuation * screenEdgeFactor * reflectionDistanceFactor;

                        gl_FragColor = mix(color, reflectColor, finalAlpha); 
                    } else {
                        gl_FragColor = color;
                    }
                }
            `;

            // --- 2. JavaScript Setup and UI Injection ---

            if (geofs.fx && geofs.fx.rrt && geofs.fx.rrt.shader) {
                geofs.api.viewer.scene.postProcessStages.remove(geofs.fx.rrt.shader);
            }
            geofs.fx.rrt = {};

            geofs.ssr.updateUniforms = function() {
                 if (geofs.fx.rrt && geofs.fx.rrt.shader) {
                      geofs.fx.rrt.shader.uniforms.strength = function() { return geofs.ssr.strength; };
                      geofs.fx.rrt.shader.uniforms.isEnabled = function() { return geofs.ssr.isEnabled; };
                 }
            };
            
            // Create the PostProcessStage
            geofs.fx.rrt.shader = new Cesium.PostProcessStage({
                fragmentShader: shaderCode,
                uniforms: {
                    strength: function() { return geofs.ssr.strength; },
                    maxDistance: function() { return geofs.ssr.maxDistance; },
                    isEnabled: function() { return geofs.ssr.isEnabled; }
                },
                selected: [planeModel]
            });

            geofs.api.viewer.scene.postProcessStages.add(geofs.fx.rrt.shader);
            
            // --- UI Injection ---
            const advancedList = document.getElementsByClassName("geofs-preference-list")[0]
                .getElementsByClassName("geofs-advanced")[0]
                .getElementsByClassName("geofs-stopMousePropagation")[0];
            
            if (advancedList) {
                // Remove old UI if exists to prevent duplicates
                const oldSwitch = document.getElementById('ssr-switch');
                const oldSlider = document.getElementById('ssr-slider');
                if(oldSwitch) oldSwitch.remove();
                if(oldSlider) oldSlider.remove();

                // Toggle Switch Logic
                geofs.ssr.toggleUpdate = function(el) {
                    geofs.ssr.isEnabled = !geofs.ssr.isEnabled;
                    el.setAttribute("class", "mdl-switch mdl-js-switch mdl-js-ripple-effect mdl-js-ripple-effect--ignore-events is-upgraded" + (geofs.ssr.isEnabled ? " is-checked" : ""));
                    geofs.ssr.updateUniforms();
                };
                
                var toggleDiv = document.createElement("label");
                toggleDiv.id = "ssr-switch";
                toggleDiv.className = "mdl-switch mdl-js-switch mdl-js-ripple-effect mdl-js-ripple-effect--ignore-events is-upgraded is-checked";
                toggleDiv.innerHTML = '<input type="checkbox" class="mdl-switch__input" checked><span class="mdl-switch__label">SSR Reflections (Smooth)</span>'; 
                toggleDiv.addEventListener("click", function() { geofs.ssr.toggleUpdate(toggleDiv); });
                advancedList.appendChild(toggleDiv);

                // Slider Setup (Native Look)
                var strengthDiv = document.createElement("div");
                strengthDiv.id = "ssr-slider";
                strengthDiv.className = "slider";
                strengthDiv.setAttribute("data-type", "slider");
                strengthDiv.setAttribute("data-min", "0");
                strengthDiv.setAttribute("data-max", "100");
                strengthDiv.setAttribute("data-precision", "1");
                
                const sliderValue = Math.round(geofs.ssr.strength * 100).toString();
                strengthDiv.setAttribute("value", sliderValue); 
                
                strengthDiv.innerHTML = `
                    <div>
                        <input type="range" 
                            min="0" 
                            max="100" 
                            step="1" 
                            value="${sliderValue}" 
                            class="slider-input">
                    </div>
                    <label>Reflection Strength (%)</label>
                `; 
                advancedList.appendChild(strengthDiv);
                
                // Event listener
                const sliderInput = strengthDiv.querySelector('.slider-input');
                if (sliderInput) {
                    sliderInput.addEventListener('input', function() {
                        const newValue = this.value;
                        geofs.ssr.updateStrength(newValue); 
                        strengthDiv.setAttribute("value", newValue);
                    });
                }

            } else {
                 console.warn("Could not find Advanced Settings list.");
            }

            console.log("SSR Installed");

        } catch (e) {
            console.error("Fatal Error To The Code:", e);
        }
    }, 2000);
})();
