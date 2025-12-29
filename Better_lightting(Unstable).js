// ==UserScript==
// @name Better-Lighting-Pro-UI
// @version x.x
// @match https://www.geo-fs.com/geofs.php?v=*
// @match https://*.geo-fs.com/geofs.php*
// @grant none
// ==/UserScript==

(function() {
    console.log("Installing Better Lighting");

    // --- CONFIGURATION ---
    const INITIAL_STRENGTH = 0.5;          
    const INITIAL_MAX_DISTANCE = 3500.0;
    const INITIAL_SMOOTH_NORMALS = true;
    const MAX_SLIDER_DISTANCE = 15000.0;
    const WATCHDOG_INTERVAL_MS = 2500;

    const v10Shader = `
        uniform sampler2D depthTexture;
        uniform sampler2D colorTexture;
        uniform bool isEnabled;
        uniform bool smoothNormals;
        uniform float strength;
        uniform float maxSearchDistance;
        varying vec2 v_textureCoordinates;

        vec3 getViewPos(vec2 uv, float depth) {
            vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
            vec4 vPos = czm_inverseProjection * ndc;
            return vPos.xyz / vPos.w;
        }

        void main() {
            #ifdef CZM_SELECTED_FEATURE
                if (!czm_selected()) { gl_FragColor = texture2D(colorTexture, v_textureCoordinates); return; }
            #endif

            float depth = czm_readDepth(depthTexture, v_textureCoordinates);
            if (depth >= 1.0 || !isEnabled) { gl_FragColor = texture2D(colorTexture, v_textureCoordinates); return; }

            vec3 pos = getViewPos(v_textureCoordinates, depth);
            vec2 sz = 1.0 / czm_viewport.zw;
            
            float rad = smoothNormals ? 6.0 : 1.0;
            
            vec3 p_right = getViewPos(v_textureCoordinates + vec2(sz.x * rad, 0.0), czm_readDepth(depthTexture, v_textureCoordinates + vec2(sz.x * rad, 0.0)));
            vec3 p_left  = getViewPos(v_textureCoordinates - vec2(sz.x * rad, 0.0), czm_readDepth(depthTexture, v_textureCoordinates - vec2(sz.x * rad, 0.0)));
            vec3 p_up    = getViewPos(v_textureCoordinates + vec2(0.0, sz.y * rad), czm_readDepth(depthTexture, v_textureCoordinates + vec2(0.0, sz.y * rad)));
            vec3 p_down  = getViewPos(v_textureCoordinates - vec2(0.0, sz.y * rad), czm_readDepth(depthTexture, v_textureCoordinates - vec2(0.0, sz.y * rad)));

            vec3 norm = normalize(cross(p_right - p_left, p_up - p_down));
            vec3 reflectDir = normalize(reflect(normalize(pos), norm));
            
            float bias = 0.2 + (abs(pos.z) * 0.01); 
            vec3 rayPos = pos + (norm * bias); 
            vec3 step = reflectDir * max(0.5, abs(pos.z) / 40.0);
            
            vec2 hitUV;
            bool hit = false;

            for(int i=0; i<60; i++) {
                rayPos += step;
                if(length(rayPos - pos) > maxSearchDistance) break;
                
                vec4 proj = czm_projection * vec4(rayPos, 1.0);
                hitUV = (proj.xy / proj.w) * 0.5 + 0.5;
                if(hitUV.x < 0.0 || hitUV.x > 1.0 || hitUV.y < 0.0 || hitUV.y > 1.0) break;

                float sceneD = czm_readDepth(depthTexture, hitUV);
                vec3 sceneP = getViewPos(hitUV, sceneD);
                if(rayPos.z < sceneP.z && abs(rayPos.z - sceneP.z) < (2.0 + abs(pos.z)*0.05)) {
                    hit = true; break;
                }
            }

            vec4 base = texture2D(colorTexture, v_textureCoordinates);
            if(hit) {
                float fresnel = 0.1 + 0.9 * pow(1.0 - max(dot(norm, -normalize(pos)), 0.0), 3.0);
                float edgeFade = clamp(1.0 - pow(length(hitUV * 2.0 - 1.0), 4.0), 0.0, 1.0);
                gl_FragColor = mix(base, texture2D(colorTexture, hitUV), strength * fresnel * edgeFade);
            } else {
                gl_FragColor = base;
            }
        }
    `;

    function updateUIValues() {
        const sDisp = document.getElementById('ssr-strength-display');
        const dDisp = document.getElementById('ssr-distance-display');
        if (sDisp) sDisp.innerText = geofs.ssr.strength.toFixed(2);
        if (dDisp) dDisp.innerText = geofs.ssr.maxSearchDistance.toFixed(0);
    }

    function createUI() {
        const target = document.querySelector('.geofs-preference-list .geofs-advanced .geofs-stopMousePropagation');
        if (!target || document.getElementById('ssr-pro-title')) return;

        target.insertAdjacentHTML('beforeend', `
            <h5 id="ssr-pro-title" style="margin-top: 15px; color: #f0ad4e; font-weight: bold;">BETTER LIGHTING (PRO)</h5>
            <div class="geofs-option">
                <span>Reflections Enabled</span>
                <label class="mdl-switch mdl-js-switch" for="ssr-enabled-toggle">
                    <input id="ssr-enabled-toggle" type="checkbox" class="mdl-switch__input" 
                        onchange="geofs.ssr.isEnabled = this.checked" ${geofs.ssr.isEnabled ? 'checked' : ''}>
                </label>
            </div>
            <div class="geofs-option">
                <span>Smooth Normals (Fix Faceting)</span>
                <label class="mdl-switch mdl-js-switch" for="ssr-normals-toggle">
                    <input id="ssr-normals-toggle" type="checkbox" class="mdl-switch__input" 
                        onchange="geofs.ssr.sNorm = this.checked" ${geofs.ssr.sNorm ? 'checked' : ''}>
                </label>
            </div>
            <div class="geofs-option">
                <span style="font-weight: bold;">Strength</span>
                <span id="ssr-strength-display">${geofs.ssr.strength.toFixed(2)}</span>
            </div>
            <div class="geofs-option mdl-slider-container">
                <input id="ssr-strength-slider" type="range" class="mdl-slider mdl-js-slider" 
                    min="0" max="1" step="0.05" value="${geofs.ssr.strength}" 
                    oninput="geofs.ssr.strength = parseFloat(this.value); document.getElementById('ssr-strength-display').innerText = this.value;">
            </div>
            <div class="geofs-option">
                <span style="font-weight: bold;">Max Distance</span>
                <span id="ssr-distance-display">${geofs.ssr.maxSearchDistance.toFixed(0)}</span>
            </div>
            <div class="geofs-option mdl-slider-container">
                <input id="ssr-distance-slider" type="range" class="mdl-slider mdl-js-slider" 
                    min="100" max="${MAX_SLIDER_DISTANCE}" step="100" value="${geofs.ssr.maxSearchDistance}" 
                    oninput="geofs.ssr.maxSearchDistance = parseFloat(this.value); document.getElementById('ssr-distance-display').innerText = this.value;">
            </div>
        `);
        if (window.componentHandler) window.componentHandler.upgradeElements(target);
    }

    window.geofs.ssr = {
        isEnabled: true,
        sNorm: INITIAL_SMOOTH_NORMALS,
        strength: INITIAL_STRENGTH,
        maxSearchDistance: INITIAL_MAX_DISTANCE
    };

    let lastModel = null;
    function applyShader() {
        if (!geofs.aircraft?.instance?.object3d) return;
        let model = geofs.aircraft.instance.object3d.model._model || geofs.aircraft.instance.object3d.model;
        if (!model) return;

        if (geofs.fx.rrt.shader) {
            geofs.api.viewer.scene.postProcessStages.remove(geofs.fx.rrt.shader);
            geofs.fx.rrt.shader.destroy();
        }

        geofs.fx.rrt.shader = new Cesium.PostProcessStage({
            fragmentShader: v10Shader,
            uniforms: {
                isEnabled: () => geofs.ssr.isEnabled,
                smoothNormals: () => geofs.ssr.sNorm,
                strength: () => geofs.ssr.strength,
                maxSearchDistance: () => geofs.ssr.maxSearchDistance
            }
        });
        geofs.fx.rrt.shader.selected = [model];
        geofs.api.viewer.scene.postProcessStages.add(geofs.fx.rrt.shader);
        lastModel = model;
    }

    geofs.fx.rrt = geofs.fx.rrt || {};
    setInterval(() => {
        let current = geofs.aircraft?.instance?.object3d?.model?._model || geofs.aircraft?.instance?.object3d?.model;
        if (current && current !== lastModel) applyShader();
        createUI();
    }, WATCHDOG_INTERVAL_MS);

    applyShader();
    setTimeout(createUI, 2000);
})();
