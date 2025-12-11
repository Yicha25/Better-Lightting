// ==UserScript==
// @name Better-Lighting
// @namespace https://github.com/Yicha25/Better-Lightting/
// @version 1.10
// @match https://www.geo-fs.com/geofs.php?v=*
// @match https://*.geo-fs.com/geofs.php*
// @grant none
// ==/UserScript==

(function() {
    console.log("Installing Better Lighting (Universal Model Fix)");


    const INITIAL_STRENGTH = 0.3;          
    const INITIAL_MAX_DISTANCE = 1500.0;
    const MAX_SLIDER_DISTANCE = 15000.0;
    const INITIAL_SMOOTH_NORMALS = false;
    const UI_INIT_DELAY_MS = 1500; 
    const WATCHDOG_INTERVAL_MS = 2000;
    let lastAircraftModel = null;
    let isFixing = false;

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

        float rand(vec2 co){return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);}
        vec4 clipToEye(vec2 uv, float depth){vec2 xy = vec2((uv.x * 2.0 - 1.0), ((1.0 - uv.y) * 2.0 - 1.0));vec4 viewPos = czm_inverseProjection * vec4(xy, depth, 1.0);viewPos = viewPos / viewPos.w;return viewPos;}
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
            
            float diffTest = 0.0; 


            vec4 startView = vec4(positionFrom.xyz + (pivot * 0.0), 1.0);
            vec4 endView = vec4(positionFrom.xyz + (pivot * maxDistance), 1.0); 
            float distTo = length(startView - endView);

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

            for (int i = 0; i < 10000; ++i) {
                if (i > int(delta)) { break; }
                if (depth1 > 0.99) { break; } 
                if (diffTest > 0.9 ) { break; } 

                frag += increment;
                uv.xy = frag / texSize;
                vec4 positionTo = clipToEye(uv.xy, uv.z);

                search1 = mix((frag.y - startFrag.y) / deltaY ,(frag.x - startFrag.x) / deltaX ,useX );
                viewDistance = (startView.y * endView.y) / mix(endView.y, startView.y, search1);
                depth = viewDistance - positionTo.y; 

                if (depth > 0.5 && depth < thickness) {
                    hit0 = 1.0;
                    break;
                } else {
                    search0 = search1;
                }
                search1 = search0 + ((search1 - search0) / 2.0);
                steps *= int(hit0);

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
                    
                    float visibility = hit1 * positionTo.w * ( 1.0 - max(dot(-unitPositionFrom, pivot), 0.0)) * (1.0 - clamp(depth / thickness, 0.0, 1.0)) * (1.0 - clamp(length(positionTo - positionFrom) / maxDistance, 0.0, 1.0)) * (uv.x < 0.0 || uv.x > 1.0 ? 0.0 : 1.0) * (uv.y < 0.0 || uv.y > 1.0 ? 0.0 : 1.0);
                    
                    visibility = clamp(visibility, 0.0, 1.0);
                    uv.ba = vec2(visibility); 
                    
                    colAtRef = texture2D(colorTexture, uv.xy);
                }
            }
            
            color = texture2D(colorTexture, v_textureCoordinates);
            
            if (colAtRef.rgb == vec3(0.0)) {
                gl_FragColor = color;
            } else {
                vec4 mixColor = mix(color, colAtRef, strength); 
                gl_FragColor = mixColor;
            }
        }
    `;

    function updateUICheckboxes() {
        const enabled = document.getElementById('ssr-enabled-toggle');
        const normals = document.getElementById('ssr-normals-toggle');
        const strengthDisplay = document.getElementById('ssr-strength-display');
        const strengthSlider = document.getElementById('ssr-strength-slider');
        const distanceDisplay = document.getElementById('ssr-distance-display');
        const distanceSlider = document.getElementById('ssr-distance-slider');

        if (enabled && geofs.ssr) enabled.checked = geofs.ssr.isEnabled;
        if (normals && geofs.ssr) normals.checked = geofs.ssr.sNorm;
        if (strengthDisplay && geofs.ssr) strengthDisplay.innerText = geofs.ssr.strength.toFixed(2);
        if (strengthSlider && geofs.ssr) strengthSlider.value = geofs.ssr.strength;
        if (distanceDisplay && geofs.ssr) distanceDisplay.innerText = geofs.ssr.maxSearchDistance.toFixed(0);
        if (distanceSlider && geofs.ssr) distanceSlider.value = geofs.ssr.maxSearchDistance;
    }

    setTimeout(function() {
        try {
            geofs["rrt.glsl"] = originalShaderCore; 

            if (typeof geofs.ssr === 'undefined') {
                geofs.ssr = {
                    isEnabled: true,
                    sNorm: INITIAL_SMOOTH_NORMALS,
                    strength: INITIAL_STRENGTH,
                    maxSearchDistance: INITIAL_MAX_DISTANCE
                };
            } else {
                if (typeof geofs.ssr.isEnabled === 'undefined') geofs.ssr.isEnabled = true;
                if (typeof geofs.ssr.sNorm === 'undefined') geofs.ssr.sNorm = INITIAL_SMOOTH_NORMALS;
                if (typeof geofs.ssr.strength === 'undefined') geofs.ssr.strength = INITIAL_STRENGTH;
                if (typeof geofs.ssr.maxSearchDistance === 'undefined') geofs.ssr.maxSearchDistance = INITIAL_MAX_DISTANCE;
            }

            geofs.fx.rrt = geofs.fx.rrt || {};
            
            geofs.fx.rrt.updateUniforms = function() {
                if (geofs.fx.rrt && geofs.fx.rrt.shader && geofs.fx.rrt.shader.uniforms) {
                    geofs.fx.rrt.shader.uniforms.isEnabled = function() { return geofs.ssr.isEnabled; };
                    geofs.fx.rrt.shader.uniforms.smoothNormals = function() { return geofs.ssr.sNorm; };
                    geofs.fx.rrt.shader.uniforms.strength = function() { return geofs.ssr.strength; };
                    geofs.fx.rrt.shader.uniforms.maxSearchDistance = function() { return geofs.ssr.maxSearchDistance; };
                }
            };
            
            geofs.fx.rrt.createShader = function() {
                if (geofs.fx.rrt.shader) {
                    if (geofs.api.viewer.scene.postProcessStages.contains(geofs.fx.rrt.shader)) {
                        geofs.api.viewer.scene.postProcessStages.remove(geofs.fx.rrt.shader);
                    }
                    if (!geofs.fx.rrt.shader.isDestroyed()) {
                        geofs.fx.rrt.shader.destroy();
                    }
                    geofs.fx.rrt.shader = null;
                }
                
                let aircraft3d = geofs.aircraft.instance.object3d;
                if (!aircraft3d || !aircraft3d.model) return false;

                // Try both standard Cesium locations for the model primitive
                const newPlaneModel = aircraft3d.model._model || aircraft3d.model;
                
                if (!newPlaneModel) return false;

                geofs.fx.rrt.shader = new Cesium.PostProcessStage({
                    fragmentShader: geofs["rrt.glsl"],
                    uniforms: {
                        isEnabled: function() { return geofs.ssr.isEnabled; },
                        smoothNormals: function() { return geofs.ssr.sNorm; },
                        strength: function() { return geofs.ssr.strength; },
                        maxSearchDistance: function() { return geofs.ssr.maxSearchDistance; },
                    }
                });
                
                geofs.fx.rrt.shader.selected = [newPlaneModel];
                geofs.api.viewer.scene.postProcessStages.add(geofs.fx.rrt.shader);
                
                lastAircraftModel = newPlaneModel; 
                return true;
            };
            
            geofs.ssr.setStrength = function(value) {
                geofs.ssr.strength = Math.max(0, Math.min(1.0, parseFloat(value)));
                updateUICheckboxes();
            };
            
            geofs.ssr.setDistance = function(value) {
                geofs.ssr.maxSearchDistance = Math.max(1.0, parseFloat(value)); 
                updateUICheckboxes();
            };
            
            geofs.ssr.toggleNormals = function() {
                geofs.ssr.sNorm = !geofs.ssr.sNorm;
                updateUICheckboxes();
            };

            geofs.ssr.toggleSSR = function() {
                geofs.ssr.isEnabled = !geofs.ssr.isEnabled;
                updateUICheckboxes();
            };

            geofs.ssr.fixPlane = function() {
                if (isFixing) return;
                isFixing = true;
                
                setTimeout(function() {
                    if(geofs.fx.rrt.createShader()){
                        console.log("SSR: Model attached.");
                    } else {
                        console.log("SSR: Model attachment failed. Will re-try.");
                    }
                    isFixing = false;
                }, 200);
            };


            setInterval(function() {
                try {
                    if (!geofs.aircraft || !geofs.aircraft.instance || !geofs.aircraft.instance.object3d) {
                         lastAircraftModel = null;
                         return;
                    }
                    
                    const aircraft3d = geofs.aircraft.instance.object3d;
                    if (!aircraft3d.model) {
                        lastAircraftModel = null;
                        return;
                    }

                    // Robust check for model reference
                    const currentModel = aircraft3d.model._model || aircraft3d.model;
                    
                    if (!currentModel) return;

                    if (currentModel !== lastAircraftModel) {
                        console.log("SSR Observer: Detected aircraft switch. Re-attaching shader...");
                        geofs.ssr.fixPlane();
                    }
                } catch (e) {
                }
            }, WATCHDOG_INTERVAL_MS);
            
            function createUI() {
                const targetElement = document.querySelector('.geofs-preference-list .geofs-advanced .geofs-stopMousePropagation');
                
                if (!targetElement) return;

                const existingTitle = Array.from(targetElement.querySelectorAll('h5')).find(el => el.textContent.includes('BETTER LIGHTING'));
                if (existingTitle) return;

                targetElement.insertAdjacentHTML('beforeend', `
                    <h5 style="margin-top: 15px; margin-bottom: 10px; color: #ff7f7f; font-weight: bold;">
                        BETTER LIGHTING (1.10)
                    </h5>
                    
                    <div class="geofs-option">
                        <span>Reflections Enabled</span>
                        <label class="mdl-switch mdl-js-switch mdl-js-ripple-effect" for="ssr-enabled-toggle">
                            <input id="ssr-enabled-toggle" type="checkbox" class="mdl-switch__input" 
                                onchange="geofs.ssr.toggleSSR()" ${geofs.ssr.isEnabled ? 'checked' : ''}>
                        </label>
                    </div>

                    <div class="geofs-option">
                        <span>Smooth Normals (Higher Quality Reflection)</span>
                        <label class="mdl-switch mdl-js-switch mdl-js-ripple-effect" for="ssr-normals-toggle">
                            <input id="ssr-normals-toggle" type="checkbox" class="mdl-switch__input" 
                                onchange="geofs.ssr.toggleNormals()" ${geofs.ssr.sNorm ? 'checked' : ''}>
                        </label>
                    </div>

                    <div class="geofs-option">
                        <span style="font-weight: bold;">Strength</span>
                        <span id="ssr-strength-display">${geofs.ssr.strength.toFixed(2)}</span>
                    </div>
                    <div class="geofs-option mdl-slider-container">
                        <input id="ssr-strength-slider" type="range" class="mdl-slider mdl-js-slider" 
                            min="0.0" max="1.0" step="0.05" value="${geofs.ssr.strength}" 
                            oninput="geofs.ssr.setStrength(this.value);"
                            onmouseup="geofs.ssr.setStrength(this.value);"
                            ontouchend="geofs.ssr.setStrength(this.value);">
                    </div>

                    <div class="geofs-option">
                        <span style="font-weight: bold;">Max Distance (meters)</span>
                        <span id="ssr-distance-display">${geofs.ssr.maxSearchDistance.toFixed(0)}</span>
                    </div>
                    <div class="geofs-option mdl-slider-container">
                        <input id="ssr-distance-slider" type="range" class="mdl-slider mdl-js-slider" 
                            min="1.0" max="${MAX_SLIDER_DISTANCE}" step="1.0" value="${geofs.ssr.maxSearchDistance}" 
                            oninput="geofs.ssr.setDistance(this.value);"
                            onmouseup="geofs.ssr.setDistance(this.value);"
                            ontouchend="geofs.ssr.setDistance(this.value);">
                    </div>
                `);

                if (window.componentHandler && typeof window.componentHandler.upgradeElements === 'function') {
                    window.componentHandler.upgradeElements(targetElement);
                }
            }

            geofs.ssr.fixPlane(); 
            
            setTimeout(function() {
                createUI();
                updateUICheckboxes();
            }, UI_INIT_DELAY_MS); 

            console.log(`Better Lighting Installed with 2-second auto-fix interval.`);

        } catch (e) {
            console.error("Initialization Error:", e);
        }
    }, 1000); 
})();
