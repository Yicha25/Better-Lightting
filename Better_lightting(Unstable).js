// ==UserScript==
// @name Better-Lighting
// @version x.x
// @match https://www.geo-fs.com/geofs.php?v=*
// @match https://*.geo-fs.com/geofs.php*
// @grant none
// ==/UserScript==

(function() {
    console.log("Better-Lightting(Unstable)");

    // --- CONFIG ---
    const CONFIG = {
        strength: 0.7,
        distance: 3500.0,
        enabled: true
    };

    const v10Shader = `
        uniform sampler2D depthTexture;
        uniform sampler2D colorTexture;
        uniform bool isEnabled;
        uniform float strength;
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
            
            // 1. RECONSTRUCT SMOOTH NORMALS
            vec2 sz = 1.0 / czm_viewport.zw;
            vec3 p1 = getViewPos(v_textureCoordinates + vec2(sz.x * 2.0, 0.0), czm_readDepth(depthTexture, v_textureCoordinates + vec2(sz.x * 2.0, 0.0)));
            vec3 p2 = getViewPos(v_textureCoordinates + vec2(0.0, sz.y * 2.0), czm_readDepth(depthTexture, v_textureCoordinates + vec2(0.0, sz.y * 2.0)));
            vec3 norm = normalize(cross(p1 - pos, p2 - pos));

            // 2. THE GEOMETRY FIX: Start the ray slightly ABOVE the surface (Expansion)
            vec3 reflectDir = normalize(reflect(normalize(pos), norm));
            vec3 rayPos = pos + (norm * 0.2); // Push 20cm away from fuselage to prevent holes
            
            // 3. ADAPTIVE RAY MARCHING
            vec3 step = reflectDir * max(0.1, abs(pos.z) / 90.0);
            vec2 hitUV;
            bool hit = false;

            for(int i=0; i<50; i++) {
                rayPos += step;
                vec4 proj = czm_projection * vec4(rayPos, 1.0);
                hitUV = (proj.xy / proj.w) * 0.5 + 0.5;
                
                if(hitUV.x < 0.0 || hitUV.x > 1.0 || hitUV.y < 0.0 || hitUV.y > 1.0) break;

                float sceneD = czm_readDepth(depthTexture, hitUV);
                vec3 sceneP = getViewPos(hitUV, sceneD);

                // Check for intersection with a 'safety buffer'
                if(rayPos.z < sceneP.z && abs(rayPos.z - sceneP.z) < (1.5 + abs(pos.z)*0.04)) {
                    hit = true; break;
                }
            }

            vec4 base = texture2D(colorTexture, v_textureCoordinates);
            if(hit) {
                // Fresnel for metal look
                float fresnel = 0.2 + 0.8 * pow(1.0 - max(dot(norm, -normalize(pos)), 0.0), 3.0);
                vec4 refl = texture2D(colorTexture, hitUV);
                gl_FragColor = mix(base, refl, strength * fresnel);
            } else {
                gl_FragColor = base;
            }
        }
    `;

    // --- UI INJECTION (MENU RESTORED) ---
    function injectUI() {
        if (document.getElementById('ssr-ui-v10')) return;
        const panel = document.querySelector('.geofs-preference-list .geofs-advanced .geofs-stopMousePropagation');
        if (!panel) return;

        panel.insertAdjacentHTML('beforeend', `
            <div id="ssr-ui-v10" style="margin-top: 15px; border-top: 1px solid #666;">
                <h5 style="color: #4effbf; font-weight: bold; padding-top: 10px;">RTX V10 (FIXED)</h5>
                <div class="geofs-option">
                    <span>Enabled</span>
                    <label class="mdl-switch mdl-js-switch" for="sw-v10">
                        <input id="sw-v10" type="checkbox" class="mdl-switch__input" ${CONFIG.enabled ? 'checked' : ''} 
                        onchange="geofs.ssr.enabled = this.checked">
                    </label>
                </div>
                <div class="geofs-option">
                    <span>Intensity</span>
                    <input type="range" min="0" max="1" step="0.05" value="${CONFIG.strength}" 
                    oninput="geofs.ssr.strength = parseFloat(this.value)">
                </div>
            </div>
        `);
        if (window.componentHandler) window.componentHandler.upgradeElements(panel);
    }

    // --- INITIALIZATION ---
    window.geofs.ssr = CONFIG;
    let lastModel = null;

    function apply() {
        if (!geofs.aircraft?.instance?.object3d) return;
        let model = geofs.aircraft.instance.object3d.model._model || geofs.aircraft.instance.object3d.model;
        
        if (geofs.fx.rrt.shader) {
            geofs.api.viewer.scene.postProcessStages.remove(geofs.fx.rrt.shader);
            geofs.fx.rrt.shader.destroy();
        }

        geofs.fx.rrt.shader = new Cesium.PostProcessStage({
            fragmentShader: v10Shader,
            uniforms: {
                isEnabled: () => geofs.ssr.enabled,
                strength: () => geofs.ssr.strength
            }
        });
        geofs.fx.rrt.shader.selected = [model];
        geofs.api.viewer.scene.postProcessStages.add(geofs.fx.rrt.shader);
        lastModel = model;
    }

    geofs.fx.rrt = geofs.fx.rrt || {};
    setInterval(() => {
        let current = geofs.aircraft?.instance?.object3d?.model?._model || geofs.aircraft?.instance?.object3d?.model;
        if (current && current !== lastModel) apply();
        injectUI();
    }, 2500);

    apply();
    injectUI();
    geofs.ui.notification.show("Better lightting loaded");
})();
