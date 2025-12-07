// ==UserScript==
// @name         Better-Lightting
// @namespace    https://github.com/Yicha25/Better-Lightting/
// @version      0.5
// @match        https://www.geo-fs.com/geofs.php?v=*
// @match        https://*.geo-fs.com/geofs.php*
// @grant        none
// ==/UserScript==

(function() {
    console.log("Installing Better Lighting by Yicha");

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
                // Convert slider value (0-100) to shader uniform (0.0-1.0)
                geofs.ssr.strength = parseFloat(value) / 100.0;
                geofs.ssr.updateUniforms(); 
            };
            
            if (!geofs.aircraft || !geofs.aircraft.instance || !geofs.aircraft.instance.object3d.model) {
                throw new Error("Aircraft model not fully loaded. Please wait.");
            }
            const planeModel = geofs.aircraft.instance.object3d.model._model;

            // --- 1. GLSL Shader Code (Unchanged) ---
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
                // --- End Helper Functions ---


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
                    
                    // *** ATTENUATION FACTOR ***
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

                    for(int i = 0; i < 30; i++) {
                        currentPos += rayDir * rayLength;
                        rayLength += maxDistance * 0.01;
                        
                        vec4 clip = czm_projection * vec4(currentPos, 1.0);
                        vec3 ndc = clip.xyz / clip.w;
                        vec2 testUV = ndc.xy * 0.5 + 0.5;

                        if(testUV.x < 0.0 || testUV.x > 1.0 || testUV.y < 0.0 || testUV.y > 1.0 || rayLength > maxDistance) break;

                        float testDepth = czm_readDepth(depthTexture, testUV);
                        vec3 testScenePos = getPosition(testUV, testDepth);

                        if(currentPos.z > testScenePos.z) {
                            hit = 1.0;
                            hitUV = testUV;
                            break;
                        }
                    }

                    // Final Mix
                    if (hit > 0.5) {
                        vec4 reflectColor = texture2D(colorTexture, hitUV);
                        gl_FragColor = mix(color, reflectColor, strength * attenuation); 
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
                // Toggle Switch Logic (unchanged)
                geofs.ssr.toggleUpdate = function(el) {
                    geofs.ssr.isEnabled = !geofs.ssr.isEnabled;
                    el.setAttribute("class", "mdl-switch mdl-js-switch mdl-js-ripple-effect mdl-js-ripple-effect--ignore-events is-upgraded" + (geofs.ssr.isEnabled ? " is-checked" : ""));
                    geofs.ssr.updateUniforms();
                };
                
                var toggleDiv = document.createElement("label");
                toggleDiv.className = "mdl-switch mdl-js-switch mdl-js-ripple-effect mdl-js-ripple-effect--ignore-events is-upgraded is-checked";
                toggleDiv.innerHTML = '<input type="checkbox" class="mdl-switch__input" checked><span class="mdl-switch__label">SSR Reflections (Stable)</span>'; 
                toggleDiv.addEventListener("click", function() { geofs.ssr.toggleUpdate(toggleDiv); });
                advancedList.appendChild(toggleDiv);

                // Slider Setup
                var strengthDiv = document.createElement("div");
                strengthDiv.className = "slider";
                strengthDiv.setAttribute("data-type", "slider");
                strengthDiv.setAttribute("data-min", "0");
                strengthDiv.setAttribute("data-max", "100");
                strengthDiv.setAttribute("data-precision", "1");
                
                const sliderValue = Math.round(geofs.ssr.strength * 100).toString();
                
                // Set the initial numeric value
                strengthDiv.setAttribute("value", sliderValue); 
                
                // *** FIX FOR NATIVE LOOK ***
                // We simplify the inner HTML to rely on GeoFS's default slider rendering scripts.
                // The structure for a native slider is simply:
                // <div><input type="range"></div><label>Text</label>
                // The GeoFS framework will then add the rail, selection, and number display.
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
                
                // Event listener for functionality and VISUAL UPDATE
                const sliderInput = strengthDiv.querySelector('.slider-input');
                if (sliderInput) {
                    sliderInput.addEventListener('input', function() {
                        const newValue = this.value;
                        
                        // 1. Update the strength in the shader
                        geofs.ssr.updateStrength(newValue); 
                        
                        // 2. Update the parent DIV's 'value' attribute (This triggers GeoFS's rendering update)
                        strengthDiv.setAttribute("value", newValue);
                        
                        // Note: We no longer manually update the .slider-selection width, 
                        // relying on the GeoFS framework to do it based on the updated 'value' attribute.
                    });
                } else {
                    console.warn("Could not find slider input element.");
                }

            } else {
                 console.warn("Could not find Advanced Settings list. UI controls will not appear.");
            }

            console.log("SSR Installed");

        } catch (e) {
            console.error("Fatal Error To The Code:", e);
            alert("Install failed. Check console for red errors.");
        }
    }, 2000);
})();
