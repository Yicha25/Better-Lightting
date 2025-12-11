// ==UserScript==
// @name Better-Lighting
// @namespace https://github.com/Yicha25/Better-Lightting/
// @version 0.x.x
// @match https://www.geo-fs.com/geofs.php?v=*
// @match https://*.geo-fs.com/geofs.php*
// @grant none
// @updateURL https://raw.githubusercontent.com/Yicha25/Better-Lightting/main/better-lightting.user.js
// @downloadURL https://raw.githubusercontent.com/Yicha25/Better-Lightting/main/better-lightting.user.js
// ==/UserScript==

(function() {
    console.log("Installing Better Lighting by Yicha (Unstable).");

    // --- Configuration Constants ---
    const INITIAL_STRENGTH = 1.0;
    const INITIAL_MAX_DISTANCE = 20.0; 
    let currentPlaneModel = null; 

    // --- 1. Original GLSL Shader Core (FIXED: Culling disabled in main) ---
    const originalShaderCore = `
        uniform sampler2D depthTexture;
        uniform sampler2D colorTexture;
        uniform int viewType;
        uniform bool smoothNormals;
        uniform bool isEnabled;
        uniform float strength;
        uniform float maxSearchDistance;
        varying vec2 v_textureCoordinates;
        #ifdef GL_OES_standard_derivatives
            #extension GL_OES_standard_derivatives : enable
        #endif 

        // [GLSL helper functions omitted for brevity]
        float rand(vec2 co){return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);}
        vec4 clipToEye(vec2 uv, float depth){vec2 xy = vec2((uv.x * 2.0 - 1.0), ((1.0 - uv.y) * 2.0 - 1.0));vec4 posEC = czm_inverseProjection * vec4(xy, depth, 1.0);posEC = posEC / posEC.w;return posEC;}
        vec4 depthToView(vec2 texCoord, float depth) {vec4 ndc = vec4(texCoord, depth, 1.0) * 2.0 - 1.0;vec4 viewPos = czm_inverseProjection * ndc;return viewPos / viewPos.w;}
        vec3 viewToDepth(vec3 pos){vec4 clip = czm_projection * vec4(pos,1.0);vec3 ndc = clip.xyz / clip.w;return ndc * .5 + .5;}
        vec3 getNormalXEdge(vec3 posInCamera, float depthU, float depthD, float depthL, float depthR, vec2 pixelSize){vec4 posInCameraUp = clipToEye(v_textureCoordinates - vec2(0.0, pixelSize.y), depthU);vec4 posInCameraDown = clipToEye(v_textureCoordinates + vec2(0.0, pixelSize.y), depthD);vec4 posInCameraLeft = clipToEye(v_textureCoordinates - vec2(pixelSize.x, 0.0), depthL);vec4 posInCameraRight = clipToEye(v_textureCoordinates + vec2(pixelSize.x, 0.0), depthR);vec3 up = posInCamera.xyz - posInCameraUp.xyz;vec3 down = posInCameraDown.xyz - posInCamera.xyz;vec3 left = posInCamera.xyz - posInCameraLeft.xyz;vec3 right = posInCameraRight.xyz - posInCamera.xyz;vec3 DX = length(left) < length(right) ? left : right;vec3 DY = length(up) < length(down) ? up : down;return normalize(cross(DY, DX));}
        vec3 recNormals(vec3 pos) {float dMp = 0.006 * pos.z; vec3 P0 = depthToView(pos.xy, pos.z).xyz;vec3 normal = normalize(cross(dFdx(P0), dFdy(P0)));float d1 = czm_readDepth(depthTexture, vec2(pos.x + dMp, pos.y + dMp));float d2 = czm_readDepth(depthTexture, vec2(pos.x - dMp, pos.y + dMp));float d3 = czm_readDepth(depthTexture, vec2(pos.x + dMp, pos.y - dMp));float d4 = czm_readDepth(depthTexture, vec2(pos.x - dMp, pos.y - dMp));vec3 P1 = depthToView(vec2(pos.x + dMp, pos.y + dMp), d1).xyz;vec3 P2 = depthToView(vec2(pos.x - dMp, pos.y + dMp), d2).xyz;vec3 P3 = depthToView(vec2(pos.x + dMp, pos.y - dMp), d3).xyz;vec3 P4 = depthToView(vec2(pos.x - dMp, pos.y - dMp), d4).xyz;vec3 normal1 = normalize(cross(dFdx(P1), dFdy(P1)));vec3 normal2 = normalize(cross(dFdx(P2), dFdy(P2)));vec3 normal3 = normalize(cross(dFdx(P3), dFdy(P3)));vec3 normal4 = normalize(cross(dFdx(P4), dFdy(P4)));if (normal1 == vec3(0.0)) { normal1 = normal; }if (normal2 == vec3(0.0)) { normal2 = normal; }if (normal3 == vec3(0.0)) { normal3 = normal; }if (normal4 == vec3(0.0)) { normal4 = normal; }if(smoothNormals == true) {return (normal + normal1 + normal2 + normal3 + normal4) / 5.0;} else {return normal;}}
        vec3 blurNormals(vec2 uv) {const float Directions = 4.0; const float Quality = 1.0; const float Size = 8.0; vec2 Radius = Size/czm_viewport.zw;const float Pi = czm_twoPi;const float PidD = Pi/Directions;float depth = czm_readDepth(depthTexture, uv);vec3 Color = recNormals(vec3(uv, depth));for( float d=0.0; d<Pi; d+=PidD) {for(float i=1.0/Quality; i<=1.0; i+=1.0/Quality) {vec2 newUv = uv+vec2(cos(d),sin(d))*Radius*i;float newDepth = czm_readDepth(depthTexture, newUv);Color += recNormals(vec3(newUv, newDepth));} }Color /= Quality * Directions - 15.0;return Color;}

        void main(void)
        {
        #ifdef CZM_SELECTED_FEATURE
            if (!czm_selected()) {
                gl_FragColor = texture2D(colorTexture, v_textureCoordinates);
                return;
            }
        #endif
            if (isEnabled == false) {
                gl_FragColor = texture2D(colorTexture, v_textureCoordinates);
                return;
            }
            
            vec4 color;
            vec4 colAtRef;
            vec3 normals;
            
            float depth1 = czm_readDepth(depthTexture, v_textureCoordinates);
            vec4 posInCamera = clipToEye(v_textureCoordinates, depth1);
            vec4 initialPos = depthToView(v_textureCoordinates, depth1); 

            if (smoothNormals == true) {
                normals = blurNormals(v_textureCoordinates);
            } else {
                normals = recNormals(vec3(v_textureCoordinates, depth1));
            }

            vec2 pixelSize = czm_pixelRatio / czm_viewport.zw;
            float depthU = czm_readDepth(depthTexture, v_textureCoordinates - vec2(0.0, pixelSize.y));
            float depthD = czm_readDepth(depthTexture, v_textureCoordinates + vec2(0.0, pixelSize.y));
            float depthL = czm_readDepth(depthTexture, v_textureCoordinates - vec2(pixelSize.x, 0.0));
            float depthR = czm_readDepth(depthTexture, v_textureCoordinates + vec2(pixelSize.x, 0.0));
            vec3 normalInCamera = getNormalXEdge(posInCamera.xyz, depthU, depthD, depthL, depthR, pixelSize);
            
            float maxDistance = maxSearchDistance; 
            float resolution = 0.5;
            int steps = 5;
            float thickness = 0.1;

            vec4 uv;
            vec2 texSize = czm_viewport.zw;
            vec2 texCoord = v_textureCoordinates / texSize;
            
            vec4 positionFrom = initialPos;
            vec3 unitPositionFrom = normalize(positionFrom.xyz);
            vec3 normal = normalize(normals);
            vec3 pivot = normalize(reflect(unitPositionFrom, normal));
            
            // --- Culling/Fade Parameters from Original Shader (TEMPORARILY DISABLED) ---
            // Original: vec3 diffVec = clamp((unitPositionFrom.xyz - abs(normal)) * 10.0 * (10.0 * depth1), 0.0, 10.0);
            // Original: float dotP = clamp(-dot(normal, unitPositionFrom) * 10.0 * (4.0 * depth1), 0.0, 10.0);
            // Original: float diffTest = clamp(1.0 - dot(pivot, unitPositionFrom), 0.0, 1.0); 

            // FIX: Set culling parameters to a constant value that disables the check, 
            // ensuring the raymarch runs across the whole object.
            float diffTest = 0.0; 
            // --- End Culling Parameters ---

            vec4 startView = vec4(positionFrom.xyz + (pivot * 0.0), 1.0);
            vec4 endView = vec4(positionFrom.xyz + (pivot * maxDistance), 1.0); 
            float distTo = length(startView - endView);

            // Ray Marching projection logic (omitted for brevity)
            vec4 startFrag = czm_projection * startView;
            startFrag.xyz /= startFrag.w;
            startFrag.xy = startFrag.xy * 0.5 + 0.5;
            startFrag.xy *= texSize;

            vec4 endFrag = czm_projection * endView;
            endFrag.xyz /= endFrag.w;
            endFrag.xy = endFrag.xy * 0.5 + 0.5;
            endFrag.xy *= texSize;

            vec2 frag = startFrag.xy;
            uv.xy = frag / texSize;

            float deltaX = endFrag.x - startFrag.x;
            float deltaY = endFrag.y - startFrag.y;
            float useX = abs(deltaX) >= abs(deltaY) ? 1.0 : 0.0;
            float delta = mix(abs(deltaY), abs(deltaX), useX) * clamp(resolution, 0.0, 1.0);

            vec2 increment = vec2(deltaX, deltaY) / max(delta, 0.001);

            float search0 = 0.0;
            float search1 = 0.0;

            float currentX = (startFrag.x) * (1.0 - search1) + (endFrag.x) * search1;
            float currentY = (startFrag.y) * (1.0 - search1) + (endFrag.y) * search1;

            float hit0 = 0.0;
            float hit1 = 0.0;

            float viewDistance = startView.z;
            float depth = thickness;

            // Coarse Ray Marching Loop
            for (int i = 0; i < 10000; ++i) {
                if (i > int(delta)) { break; }
                if (depth1 > 0.99) { break; } 
                
                // IMPORTANT: The check below is now effectively disabled by setting diffTest = 0.0
                if (diffTest > 0.9 ) { break; } 

                frag += increment;
                uv.xy = frag / texSize;
                vec4 positionTo = clipToEye(uv.xy, uv.z);

                // --- LINEAR DEPTH INTERPOLATION ---
                search1 = mix((frag.y - startFrag.y) / deltaY ,(frag.x - startFrag.x) / deltaX ,useX );
                viewDistance = (startView.y * endView.y) / mix(endView.y, startView.y, search1);
                depth = viewDistance - positionTo.y; 

                // --- HIT CHECK ---
                if (depth > 0.5 && depth < thickness) {
                    hit0 = 1.0;
                    break;
                } else {
                    search0 = search1;
                }
                search1 = search0 + ((search1 - search0) / 2.0);
                steps *= int(hit0);

                // Fine Ray Marching Loop (Binary Search)
                for (int j = 0; j < 10000; ++j) {
                    if (j > steps) { break; }
                    
                    frag = mix(startFrag.xy, endFrag.xy, search1);
                    uv.xy = frag / texSize;
                    positionTo = clipToEye(uv.xy, uv.z);
                    
                    viewDistance = (startView.y * endView.y) / mix(endView.y, startView.y, search1);
                    depth = viewDistance - positionTo.y;
                    
                    if (depth > 0.0 && depth < thickness) {
                        hit1 = 1.0;
                        search1 = search0 + ((search1 - search0) / 2.0);
                    } else {
                        float temp = search1;
                        search1 = search1 + ((search1 - search0) / 2.0);
                        search0 = temp;
                    }
                    
                    // Final Visibility Calculation
                    float visibility = hit1 * positionTo.w * ( 1.0 - max(dot(-unitPositionFrom, pivot), 0.0)) * (1.0 - clamp(depth / thickness, 0.0, 1.0)) * (1.0 - clamp(length(positionTo - positionFrom) / maxDistance, 0.0, 1.0)) * (uv.x < 0.0 || uv.x > 1.0 ? 0.0 : 1.0) * (uv.y < 0.0 || uv.y > 1.0 ? 0.0 : 1.0);
                    
                    visibility = clamp(visibility, 0.0, 1.0);
                    uv.ba = vec2(visibility); 
                    
                    colAtRef = texture2D(colorTexture, uv.xy);
                }
            }
            
            color = texture2D(colorTexture, v_textureCoordinates);
            
            // Final Mix based on whether a reflection color was found
            if (colAtRef.rgb == vec3(0.0)) {
                gl_FragColor = color;
            } else {
                // By disabling the culling logic above, we test if the reflections render properly now.
                vec4 mixColor = mix(color, colAtRef, strength); 
                gl_FragColor = mixColor;
            }
        }
    `;


    setTimeout(function() {
        try {
            // Assign the GLSL string
            geofs["rrt.glsl"] = originalShaderCore; 

            // Initialize or retrieve SSR settings (omitted for brevity)
            if (typeof geofs.ssr === 'undefined') {geofs.ssr = {isEnabled: true,sNorm: true,strength: INITIAL_STRENGTH,maxSearchDistance: INITIAL_MAX_DISTANCE };} else {if (typeof geofs.ssr.maxSearchDistance === 'undefined') {geofs.ssr.maxSearchDistance = INITIAL_MAX_DISTANCE;}}

            geofs.fx.rrt = geofs.fx.rrt || {};
            
            geofs.fx.rrt.updateUniforms = function() {
                if (geofs.fx.rrt && geofs.fx.rrt.shader) {
                    geofs.fx.rrt.shader.uniforms.isEnabled = function() { return geofs.ssr.isEnabled; };
                    geofs.fx.rrt.shader.uniforms.smoothNormals = function() { return geofs.ssr.sNorm; };
                    geofs.fx.rrt.shader.uniforms.strength = function() { return geofs.ssr.strength; };
                    geofs.fx.rrt.shader.uniforms.maxSearchDistance = function() { return geofs.ssr.maxSearchDistance; };
                }
            };
            
            // UI Handlers (omitted for brevity)
            geofs.ssr.updateSearchDistance = function(newValue) {geofs.ssr.maxSearchDistance = parseFloat(newValue);geofs.fx.rrt.updateUniforms();};
            geofs.ssr.update = function() {geofs.ssr.isEnabled = !geofs.ssr.isEnabled;const toggleElement = document.getElementById("ssr");if (toggleElement) {toggleElement.setAttribute("class", "mdl-switch mdl-js-switch mdl-js-ripple-effect mdl-js-ripple-effect--ignore-events is-upgraded" + (geofs.ssr.isEnabled ? " is-checked" : ""));}geofs.fx.rrt.updateUniforms();};
            geofs.ssr.update1 = function() {geofs.ssr.sNorm = !geofs.ssr.sNorm;const normalsElement = document.getElementById("normals");if (normalsElement) {normalsElement.setAttribute("class", "mdl-switch mdl-js-switch mdl-js-ripple-effect mdl-js-ripple-effect--ignore-events is-upgraded" + (geofs.ssr.sNorm ? " is-checked" : ""));}geofs.fx.rrt.updateUniforms();};
            geofs.ssr.updateStrength = function(newValue) {geofs.ssr.strength = parseFloat(newValue);geofs.fx.rrt.updateUniforms();};
            
            // --- UI Injection (omitted for brevity, just update version number) ---
            let elementSel = document.getElementsByClassName("geofs-preference-list")[0].getElementsByClassName("geofs-advanced")[0].getElementsByClassName("geofs-stopMousePropagation")[0];
            
            if (elementSel) {
                let toggle = document.createElement("label");
                toggle.id = "ssr";
                toggle.className = "mdl-switch mdl-js-switch mdl-js-ripple-effect mdl-js-ripple-effect--ignore-events is-upgraded" + (geofs.ssr.isEnabled ? " is-checked" : "");
                toggle.innerHTML = '<input type="checkbox" class="mdl-switch__input" ' + (geofs.ssr.isEnabled ? 'checked' : '') + '><span class="mdl-switch__label">Screen Space Reflections (V0.2.4)</span>';
                elementSel.appendChild(toggle);
                toggle.addEventListener("click", geofs.ssr.update);

                let normals = document.createElement("label");
                normals.id = "normals";
                normals.className = "mdl-switch mdl-js-switch mdl-js-ripple-effect mdl-js-ripple-effect--ignore-events is-upgraded" + (geofs.ssr.sNorm ? " is-checked" : "");
                normals.innerHTML = '<input type="checkbox" class="mdl-switch__input" ' + (geofs.ssr.sNorm ? 'checked' : '') + '><span class="mdl-switch__label">Smooth Normals</span>';
                elementSel.appendChild(normals);
                normals.addEventListener("click", geofs.ssr.update1);

                let strengthDiv = document.createElement("div");
                strengthDiv.id = "strength";
                strengthDiv.className = "slider";
                strengthDiv.setAttribute("data-type", "slider");
                strengthDiv.setAttribute("data-min", "0.0");
                strengthDiv.setAttribute("data-max", "1.0");
                strengthDiv.setAttribute("data-precision", "2");
                strengthDiv.setAttribute("value", geofs.ssr.strength.toString());

                strengthDiv.innerHTML = `<div><input type="range" min="0.0" max="1.0" step="0.01" value="${geofs.ssr.strength.toString()}" class="slider-input"></div><label>Reflection Strength</label>`;
                elementSel.appendChild(strengthDiv);
                
                const strengthInput = strengthDiv.querySelector('.slider-input');
                if (strengthInput) {
                    strengthInput.addEventListener('input', function() {
                        const newValue = this.value;
                        geofs.ssr.updateStrength(newValue);
                        strengthDiv.setAttribute("value", newValue);
                    });
                }
                
                let distanceDiv = document.createElement("div");
                distanceDiv.id = "maxDistance";
                distanceDiv.className = "slider";
                distanceDiv.setAttribute("data-type", "slider");
                distanceDiv.setAttribute("data-min", "1.0");
                distanceDiv.setAttribute("data-max", "100.0"); 
                distanceDiv.setAttribute("data-precision", "1");
                distanceDiv.setAttribute("value", geofs.ssr.maxSearchDistance.toString());

                distanceDiv.innerHTML = `<div><input type="range" min="1.0" max="100.0" step="0.5" value="${geofs.ssr.maxSearchDistance.toString()}" class="slider-input"></div><label>Reflection Search Distance (View Units)</label>`;
                elementSel.appendChild(distanceDiv);

                const distanceInput = distanceDiv.querySelector('.slider-input');
                if (distanceInput) {
                    distanceInput.addEventListener('input', function() {
                        const newValue = this.value;
                        geofs.ssr.updateSearchDistance(newValue);
                        distanceDiv.setAttribute("value", newValue);
                    });
                }


            } else {
                console.warn("Could not find Advanced Settings list. UI controls will not appear.");
            }

            
            geofs.fx.rrt.createShader = function() {
                
                if (geofs.fx.rrt.shader && geofs.api.viewer.scene.postProcessStages.contains(geofs.fx.rrt.shader)) {
                    geofs.api.viewer.scene.postProcessStages.remove(geofs.fx.rrt.shader);
                    geofs.fx.rrt.shader.destroy(); 
                    geofs.fx.rrt.shader = null;
                }
                
                if (!geofs.aircraft || !geofs.aircraft.instance || !geofs.aircraft.instance.object3d.model) {
                    console.warn("Cannot create SSR shader: Aircraft model is null.");
                    return;
                }
                
                const newPlaneModel = geofs.aircraft.instance.object3d.model._model;
                currentPlaneModel = newPlaneModel;

                geofs.fx.rrt.shader = new Cesium.PostProcessStage({
                    fragmentShader: geofs["rrt.glsl"],
                    uniforms: {
                        isEnabled: function() { return geofs.ssr.isEnabled; },
                        smoothNormals: function() { return geofs.ssr.sNorm; },
                        strength: function() { return geofs.ssr.strength; },
                        maxSearchDistance: function() { return geofs.ssr.maxSearchDistance; },
                    }
                });
                
                geofs.fx.rrt.shader.selected = [currentPlaneModel];
                geofs.api.viewer.scene.postProcessStages.add(geofs.fx.rrt.shader);
                console.log("SSR Shader attached and re-added to aircraft model.");
            };
            
            geofs.fx.rrt.monitorAircraft = function() {
                if (geofs.aircraft && geofs.aircraft.instance && geofs.aircraft.instance.object3d.model) {
                    const newPlaneModel = geofs.aircraft.instance.object3d.model._model;
                    
                    if (newPlaneModel !== currentPlaneModel) {
                        geofs.fx.rrt.createShader();
                    }
                }
            };

            // Initial setup (delayed for stability)
            geofs.fx.rrt.createShader();
            geofs.fx.rrt.updateUniforms(); 

            // High-speed monitoring interval
            setInterval(function(){
                geofs.fx.rrt.monitorAircraft();
                geofs.fx.rrt.updateUniforms();
            }, 100); 

            console.log("SSR Installed successfully.");

        } catch (e) {
            console.error("Fatal Error To The Code:", e);
            alert("Install failed. Check console for red errors. The script may have started before the GeoFS engine.");
        }
    }, 7000); 
})();
