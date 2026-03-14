// ==UserScript==
// @name         Better Lighting
// @version      x.x
// @match        https://www.geo-fs.com/geofs.php*
// @match        https://*.geo-fs.com/geofs.php*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const SSRT_SHADER = `
        uniform sampler2D depthTexture;
        uniform sampler2D colorTexture;
        uniform bool isEnabled;
        uniform float strength;
        uniform float reflectivity;
        uniform float detectionSensitivity;
        uniform float distortion;
        uniform float contactBias;
        uniform float quality;
        varying vec2 v_textureCoordinates;

        vec3 getViewPos(vec2 uv, float depth) {
            vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
            vec4 vPos = czm_inverseProjection * ndc;
            return vPos.xyz / vPos.w;
        }

        vec3 getNormal(vec2 uv, float depth, vec2 sz) {
            vec3 p  = getViewPos(uv, depth);
            vec3 pr = getViewPos(uv + vec2(sz.x, 0.0), czm_readDepth(depthTexture, uv + vec2(sz.x, 0.0)));
            vec3 pu = getViewPos(uv + vec2(0.0, sz.y), czm_readDepth(depthTexture, uv + vec2(0.0, sz.y)));
            return normalize(cross(pr - p, pu - p));
        }

        void main() {
            vec4 baseColor = texture2D(colorTexture, v_textureCoordinates);
            float depth = czm_readDepth(depthTexture, v_textureCoordinates);

            if (!isEnabled || depth >= 1.0 || v_textureCoordinates.y < 0.01) { 
                gl_FragColor = baseColor; 
                return; 
            }

            float waterScore = (baseColor.b + baseColor.g * 0.5) / (baseColor.r + 0.1);
            bool isWater = waterScore > (2.5 - detectionSensitivity);
            
            bool isSelected = false;
            #ifdef CZM_SELECTED_FEATURE
                if (czm_selected()) isSelected = true;
            #endif

            if (!isSelected && !isWater) {
                gl_FragColor = baseColor;
                return;
            }

            vec2 sz = 1.0 / czm_viewport.zw;
            vec3 pos = getViewPos(v_textureCoordinates, depth);
            vec3 norm = getNormal(v_textureCoordinates, depth, sz);
            vec3 viewDir = normalize(pos);
            vec3 reflectDir = reflect(viewDir, norm);

            vec3 rayPos = pos + norm * contactBias; 
            vec2 hitUV;
            bool hit = false;
            float currentStep = quality;
            
            for (int i = 0; i < 280; i++) {
                rayPos += reflectDir * currentStep;
                currentStep *= 1.012; 

                vec4 proj = czm_projection * vec4(rayPos, 1.0);
                hitUV = (proj.xy / proj.w) * 0.5 + 0.5;

                if (hitUV.x < 0.0 || hitUV.x > 1.0 || hitUV.y < 0.0 || hitUV.y > 1.0) break;

                float sceneD = czm_readDepth(depthTexture, hitUV);
                vec3 sceneP = getViewPos(hitUV, sceneD);
                float zDiff = sceneP.z - rayPos.z;

                if (zDiff > 0.0 && zDiff < (currentStep * 4.0)) {
                    for(int j = 0; j < 4; j++) {
                        currentStep *= 0.5;
                        rayPos -= reflectDir * currentStep;
                        proj = czm_projection * vec4(rayPos, 1.0);
                        hitUV = (proj.xy / proj.w) * 0.5 + 0.5;
                        sceneD = czm_readDepth(depthTexture, hitUV);
                        sceneP = getViewPos(hitUV, sceneD);
                        if (sceneP.z - rayPos.z < 0.0) rayPos += reflectDir * currentStep;
                    }
                    hit = true;
                    break;
                }
                if (rayPos.z > 0.0) break;
            }

            if (hit) {
                float fresnel = reflectivity + (1.0 - reflectivity) * pow(1.0 - max(dot(norm, -viewDir), 0.0), 5.0);
                float edgeFade = smoothstep(1.0, 0.8, length(hitUV * 2.0 - 1.0));
                vec4 refColor = texture2D(colorTexture, hitUV);
                
                float finalStrength = isWater ? strength * 0.7 : strength;
                gl_FragColor = mix(baseColor, refColor, finalStrength * fresnel * edgeFade);
            } else {
                gl_FragColor = baseColor;
            }
        }
    `;

    class SSRTManager {
        constructor() {
            this.state = { isEnabled: true, strength: 0.85, reflectivity: 0.5, detection: 1.1, contact: 0.03, quality: 0.08 };
            this.lastModel = null;
            this.stage = null;
            this.isApplying = false;
        }

        findModel() {
            try {
                const ac = window.geofs?.aircraft?.instance;
                if (!ac) return null;
                let m = ac.object3d?.model?._model || ac.object3d?.model;
                if (!m || typeof m.render !== 'function') m = ac.object3d?.model?._models?.[0] || m;
                const isReady = m && (m.ready || m._ready || (m.primitive && m.primitive.ready));
                return isReady ? m : null;
            } catch(e) { return null; }
        }

        init() {
            setInterval(() => {
                const currentModel = this.findModel();
                if (currentModel && currentModel !== this.lastModel && !this.isApplying) {
                    this.isApplying = true;
                    setTimeout(() => {
                        this.apply(currentModel);
                        this.isApplying = false;
                    }, 5000);
                }
                this.ui();
            }, 2000);
        }

        apply(model) {
            if (this.stage) {
                geofs.api.viewer.scene.postProcessStages.remove(this.stage);
                this.stage = null;
            }
            try {
                this.stage = new Cesium.PostProcessStage({
                    fragmentShader: SSRT_SHADER,
                    uniforms: {
                        isEnabled: () => this.state.isEnabled, 
                        strength: () => this.state.strength,
                        reflectivity: () => this.state.reflectivity, 
                        detectionSensitivity: () => this.state.detection,
                        contactBias: () => this.state.contact,
                        quality: () => this.state.quality          
                    }
                });
                this.stage.selected = [model];
                geofs.api.viewer.scene.postProcessStages.add(this.stage);
                this.lastModel = model;
            } catch (e) { console.warn(e); }
        }

        ui() {
            const target = document.querySelector('.geofs-preference-list .geofs-advanced .geofs-stopMousePropagation');
            if (!target || document.getElementById('ssrt-ui')) return;
            const uiHTML = `
                <div id="ssrt-ui" style="border-top: 1px solid #555; margin-top: 10px; padding-top: 10px;">
                    <h5 style="color: #00d4ff; font-weight: bold;">Better Lighting</h5>
                    <div class="geofs-option"><span>Reflect Strength</span><input id="sl_str" type="range" class="mdl-slider" min="0" max="1" step="0.01" value="${this.state.strength}"></div>
                    <div class="geofs-option"><span>Reflect Quality (Lower = Better)</span><input id="sl_qual" type="range" class="mdl-slider" min="0.02" max="0.3" step="0.01" value="${this.state.quality}"></div>
                    <div class="geofs-option"><span>Contact Gap</span><input id="sl_con" type="range" class="mdl-slider" min="0.01" max="0.2" step="0.01" value="${this.state.contact}"></div>
                </div>`;
            target.insertAdjacentHTML('beforeend', uiHTML);
            document.getElementById('sl_str').oninput = (e) => this.state.strength = parseFloat(e.target.value);
            document.getElementById('sl_qual').oninput = (e) => this.state.quality = parseFloat(e.target.value);
            document.getElementById('sl_con').oninput = (e) => this.state.contact = parseFloat(e.target.value);
            if (window.componentHandler) window.componentHandler.upgradeElements(document.getElementById('ssrt-ui'));
        }
    }

    const startup = setInterval(() => {
        if (window.Cesium && window.geofs?.api?.viewer) {
            clearInterval(startup);
            new SSRTManager().init();
        }
    }, 1000);
})();
