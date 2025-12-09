// ==UserScript==
// @name         Better-Lighting
// @namespace    https://github.com/Yicha25/Better-Lighting/
// @version      0.x.x
// @match        https://www.geo-fs.com/geofs.php?v=*
// @match        https://*.geo-fs.com/geofs.php*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    console.log("Installing Better Lighting (Unstable).");

    const waitForGeoFS = setInterval(function() {
        if (geofs.aircraft && geofs.aircraft.instance && geofs.aircraft.instance.object3d.model) {
            clearInterval(waitForGeoFS);
            initSSR();
        }
    }, 500);

    function initSSR() {
        try {
            // --- Configuration & Global State ---
            const initialStrength = 0.85; 

            if (typeof geofs.ssr === 'undefined') {
                geofs.ssr = {
                    strength: initialStrength,
                    maxDistance: 100000.0,
                    isEnabled: true
                };
            }

            geofs.ssr.updateStrength = function(value) {
                geofs.ssr.strength = parseFloat(value) / 100.0;
                geofs.ssr.updateUniforms();
            };

            const planeModel = geofs.aircraft.instance.object3d.model._model;

            // --- GLSL Shader Code (SSGI + SSAS Hybrid) ---
            const shaderCode = `
                #extension GL_OES_standard_derivatives : enable
                precision highp float; 
                uniform sampler2D depthTexture;
                uniform sampler2D colorTexture;
                uniform float strength;
                uniform float maxDistance;
                uniform bool isEnabled;

                varying vec2 v_textureCoordinates;

                // SSAO/SSAS Configuration
                const int SSAO_SAMPLES = 8;
                const float AO_RADIUS = 0.005; // Sample distance on screen
                const float AO_POWER = 1.2;

                // --- Helper Functions ---
                vec3 getPosition(vec2 uv, float depth) {
                    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
                    vec4 viewPos = czm_inverseProjection * ndc;
                    return viewPos.xyz / viewPos.w;
                }

                vec3 getNormal(vec3 pos) {
                    return normalize(cross(dFdx(pos), dFdy(pos)));
                }

                float rand(vec2 co) {
                    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
                }

                // --- SCREEN SPACE AMBIENT SHADING (SSAS) ---
                float calculateObscurance(vec3 currentPos, float currentDepth) {
                    float obscurance = 0.0;
                    vec2 texelSize = 1.0 / czm_viewport.zw;
                    
                    // Simple random jitter to hide banding
                    vec2 noise = vec2(rand(v_textureCoordinates), rand(v_textureCoordinates.yx)) * 2.0 - 1.0; 
                    
                    for (int i = 0; i < SSAO_SAMPLES; i++) {
                        // Sample a random point nearby
                        float angle = float(i) * 6.28 / float(SSAO_SAMPLES);
                        vec2 offsetUV = v_textureCoordinates + vec2(cos(angle), sin(angle)) * AO_RADIUS * (0.5 + 0.5 * noise);

                        float sampleDepth = czm_readDepth(depthTexture, offsetUV);

                        if (sampleDepth < 1.0) {
                            vec3 samplePos = getPosition(offsetUV, sampleDepth);

                            // Calculate distance in view space
                            float distance = length(currentPos - samplePos);
                            
                            // Obscurance increases if the sampled point is close and behind the current point
                            // We use a simple depth check for fast approximation
                            float occlusion = 1.0 - smoothstep(0.01, 0.5, currentDepth - sampleDepth);
                            
                            obscurance += occlusion * (1.0 - distance / 10.0); // Attenuate by distance
                        }
                    }
                    
                    // Final obscurance factor (clamped and powered)
                    obscurance = pow(clamp(1.0 - obscurance / float(SSAO_SAMPLES), 0.0, 1.0), AO_POWER);
                    return mix(0.7, 1.0, obscurance); // Keep ambient light from getting too dark
                }

                void main(void) {
                    if (!isEnabled) {
                        gl_FragColor = texture2D(colorTexture, v_textureCoordinates);
                        return;
                    }

                    vec4 color = texture2D(colorTexture, v_textureCoordinates);
                    float depth = czm_readDepth(depthTexture, v_textureCoordinates);

                    if (depth >= 0.999) {
                        gl_FragColor = color;
                        return;
                    }

                    vec3 pos = getPosition(v_textureCoordinates, depth);
                    vec3 normal = getNormal(pos);
                    vec3 viewDir = normalize(pos);
                    vec3 rayDir = normalize(reflect(viewDir, normal));

                    // 1. SSAO/SSAS Calculation
                    float ambientObscurance = calculateObscurance(pos, depth);
                    
                    // --- SSR (SSGI) Calculation ---
                    float fresnel = 1.0 - max(dot(-viewDir, normal), 0.0);
                    fresnel = pow(fresnel, 2.5); 
                    float angleAttenuation = mix(0.1, 1.0, fresnel);

                    vec3 currentPos = pos;
                    float stepSize = maxDistance * 0.0025; 
                    float currentDist = stepSize;

                    float hit = 0.0;
                    vec2 hitUV = vec2(0.0);
                    float iterations = 0.0;
                    
                    const int MAX_ITER = 80;

                    for(int i = 0; i < MAX_ITER; i++) {
                        currentPos = pos + rayDir * currentDist;
                        currentDist += stepSize * (1.0 + float(i) * 0.02);
                        iterations += 1.0;

                        vec4 clip = czm_projection * vec4(currentPos, 1.0);
                        vec3 ndc = clip.xyz / clip.w;
                        vec2 testUV = ndc.xy * 0.5 + 0.5;

                        if(testUV.x < 0.0 || testUV.x > 1.0 || testUV.y < 0.0 || testUV.y > 1.0 || currentDist > maxDistance) break;

                        float testDepth = czm_readDepth(depthTexture, testUV);
                        
                        if(testDepth >= 0.999) continue;
                        
                        vec3 testScenePos = getPosition(testUV, testDepth);

                        float thickness = stepSize * 2.0 * (1.0 + float(i)*0.05); 
                        if(currentPos.z > testScenePos.z && currentPos.z < testScenePos.z + thickness) {
                            hit = 1.0;
                            hitUV = testUV;
                            break;
                        }
                    }

                    // --- Final Mix ---
                    if (hit > 0.5) {
                        vec2 texelSize = 1.0 / czm_viewport.zw;
                        float blurRadius = 2.0; 
                        vec4 reflectColorSum = vec4(0.0);
                        
                        reflectColorSum += texture2D(colorTexture, hitUV); 
                        
                        float r = rand(v_textureCoordinates.xy);
                        vec2 offset1 = vec2(cos(r * 6.28), sin(r * 6.28)) * texelSize * blurRadius; 
                        vec2 offset2 = vec2(cos((r + 0.5) * 6.28), sin((r + 0.5) * 6.28)) * texelSize * blurRadius; 

                        reflectColorSum += texture2D(colorTexture, hitUV + offset1);
                        reflectColorSum += texture2D(colorTexture, hitUV + offset2);

                        vec4 reflectColor = reflectColorSum / 3.0;

                        // Edge fading
                        vec2 dCoords = smoothstep(0.1, 0.5, abs(vec2(0.5, 0.5) - hitUV.xy));
                        float screenEdgeFactor = clamp(1.0 - (dCoords.x + dCoords.y) * 2.0, 0.0, 1.0);

                        // Distance fading
                        float reflectionDistanceFactor = 1.0 - clamp(iterations / float(MAX_ITER), 0.0, 1.0);

                        // Combine all attenuation factors
                        float finalAlpha = strength * angleAttenuation * screenEdgeFactor * reflectionDistanceFactor;
                        finalAlpha = clamp(finalAlpha, 0.0, 0.95);

                        // Combine the base color (multiplied by AO) with the reflection
                        vec3 finalColor = mix(color.rgb * ambientObscurance, reflectColor.rgb, finalAlpha);

                        gl_FragColor = vec4(finalColor, 1.0);
                    } else {
                        // Apply SSAO/SSAS only to the base color if no reflection hit
                        gl_FragColor = vec4(color.rgb * ambientObscurance, 1.0);
                    }
                }
            `;

            // --- Javascript Setup ---
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
            injectSSRUI();
            console.log("SSGI + SSAS Hybrid Installed");

        } catch (e) {
            console.error("SSR Install Error:", e);
        }
    }

    function injectSSRUI() {
        const advancedList = document.querySelector(".geofs-preference-list .geofs-advanced .geofs-stopMousePropagation");

        if (advancedList) {
            // Clean old UI
            if(document.getElementById('ssr-switch-hires')) document.getElementById('ssr-switch-hires').remove();
            if(document.getElementById('ssr-slider-hires')) document.getElementById('ssr-slider-hires').remove();

            // Toggle
            geofs.ssr.toggleUpdate = function(el) {
                geofs.ssr.isEnabled = !geofs.ssr.isEnabled;
                el.className = "mdl-switch mdl-js-switch mdl-js-ripple-effect mdl-js-ripple-effect--ignore-events is-upgraded" + (geofs.ssr.isEnabled ? " is-checked" : "");
                geofs.ssr.updateUniforms();
            };

            var toggleDiv = document.createElement("label");
            toggleDiv.id = "ssr-switch-hires";
            toggleDiv.className = "mdl-switch mdl-js-switch mdl-js-ripple-effect mdl-js-ripple-effect--ignore-events is-upgraded is-checked";
            toggleDiv.innerHTML = '<input type="checkbox" class="mdl-switch__input" checked><span class="mdl-switch__label">SSGI + SSAS Hybrid</span>';
            toggleDiv.addEventListener("click", function() { geofs.ssr.toggleUpdate(toggleDiv); });
            advancedList.appendChild(toggleDiv);

            // Slider
            var strengthDiv = document.createElement("div");
            strengthDiv.id = "ssr-slider-hires";
            strengthDiv.className = "slider";
            strengthDiv.setAttribute("data-type", "slider");
            strengthDiv.setAttribute("data-min", "0");
            strengthDiv.setAttribute("data-max", "100");
            strengthDiv.setAttribute("data-precision", "1");
            const sliderValue = Math.round(geofs.ssr.strength * 100).toString();
            strengthDiv.setAttribute("value", sliderValue);

            strengthDiv.innerHTML = `
                <div>
                    <input type="range" min="0" max="100" step="1" value="${sliderValue}" class="slider-input">
                    <span class="data-value">${sliderValue}</span>
                </div>
                <label>Reflection Strength (%)</label>
            `;
            advancedList.appendChild(strengthDiv);

            const sliderInput = strengthDiv.querySelector('.slider-input');
            const valueDisplay = strengthDiv.querySelector('.data-value');

            if (sliderInput && valueDisplay) {
                sliderInput.addEventListener('input', function() {
                    const newValue = this.value;
                    
                    geofs.ssr.updateStrength(newValue);
                    
                    strengthDiv.setAttribute("value", newValue);
                    
                    valueDisplay.textContent = newValue;
                });
            }
        }
    }
})();
