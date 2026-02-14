// ==UserScript==
// @name         GeoFS Better Lighting
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

        uniform bool smoothNormals;

        uniform float strength;

        uniform float reflectivity;

        uniform float maxSearchDistance;

        varying vec2 v_textureCoordinates;



        vec3 getViewPos(vec2 uv, float depth) {

            vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);

            vec4 vPos = czm_inverseProjection * ndc;

            return vPos.xyz / vPos.w;

        }



        vec3 getSmoothNormal(vec2 uv, float depth, vec2 sz) {

            float rad = smoothNormals ? 3.0 : 1.0;

            vec3 p  = getViewPos(uv, depth);

            vec3 pr = getViewPos(uv + vec2(sz.x * rad, 0.0), czm_readDepth(depthTexture, uv + vec2(sz.x * rad, 0.0)));

            vec3 pl = getViewPos(uv - vec2(sz.x * rad, 0.0), czm_readDepth(depthTexture, uv - vec2(sz.x * rad, 0.0)));

            vec3 pu = getViewPos(uv + vec2(0.0, sz.y * rad), czm_readDepth(depthTexture, uv + vec2(0.0, sz.y * rad)));

            vec3 pd = getViewPos(uv - vec2(0.0, sz.y * rad), czm_readDepth(depthTexture, uv - vec2(0.0, sz.y * rad)));

            return normalize(cross(pr - pl, pu - pd));

        }



        void main() {

            #ifdef CZM_SELECTED_FEATURE

                if (!czm_selected()) { gl_FragColor = texture2D(colorTexture, v_textureCoordinates); return; }

            #endif



            float depth = czm_readDepth(depthTexture, v_textureCoordinates);

            vec4 baseColor = texture2D(colorTexture, v_textureCoordinates);





            if (!isEnabled || depth >= 1.0 || v_textureCoordinates.y < 0.02) { 

                gl_FragColor = baseColor; 

                return; 

            }



            vec2 sz = 1.0 / czm_viewport.zw;

            vec3 pos = getViewPos(v_textureCoordinates, depth);

            vec3 norm = getSmoothNormal(v_textureCoordinates, depth, sz);

            vec3 viewDir = normalize(pos);

            vec3 reflectDir = reflect(viewDir, norm);




            vec3 rayPos = pos + norm * 0.4; 

            


            float stepSize = 0.25; 

            vec2 hitUV;

            bool hit = false;

            float totalDist = 0.0;



            for (int i = 0; i < 80; i++) {

                rayPos += reflectDir * stepSize;

                totalDist += stepSize;



                vec4 proj = czm_projection * vec4(rayPos, 1.0);

                hitUV = (proj.xy / proj.w) * 0.5 + 0.5;



                if (hitUV.x < 0.0 || hitUV.x > 1.0 || hitUV.y < 0.0 || hitUV.y > 1.0) break;



                float sceneD = czm_readDepth(depthTexture, hitUV);

                vec3 sceneP = getViewPos(hitUV, sceneD);

                

                float zDiff = sceneP.z - rayPos.z;





                if (zDiff > 0.0 && zDiff < (0.8 + totalDist * 0.06)) {



                    vec3 hitNorm = getSmoothNormal(hitUV, sceneD, sz);

                    if (dot(norm, hitNorm) < 0.92) {

                        hit = true;

                        break;

                    }

                }

                if (totalDist > maxSearchDistance) break;

            }



            if (hit) {

                float fresnel = reflectivity + (1.0 - reflectivity) * pow(1.0 - max(dot(norm, -viewDir), 0.0), 5.0);

                float edgeFade = smoothstep(1.0, 0.8, length(hitUV * 2.0 - 1.0));

                

                // Extra fade for the screen bottom to remove that black horizontal glitch

                float groundSafety = smoothstep(0.0, 0.15, v_textureCoordinates.y);



                vec4 refColor = texture2D(colorTexture, hitUV);

                gl_FragColor = mix(baseColor, refColor, strength * fresnel * edgeFade * groundSafety);

            } else {

                gl_FragColor = baseColor;

            }

        }

    `;



    class SSRTManager {

        constructor() {

            this.state = { isEnabled: true, smoothNormals: true, strength: 0.9, reflectivity: 0.2, maxDist: 8000 };

            this.lastModel = null;

            this.stage = null;

        }



        init() {

            setInterval(() => {

                const model = geofs.aircraft?.instance?.object3d?.model?._model || geofs.aircraft?.instance?.object3d?.model;

                if (model && model !== this.lastModel) this.apply(model);

                this.ui();

            }, 2000);

        }



        apply(model) {

            if (this.stage) geofs.api.viewer.scene.postProcessStages.remove(this.stage);

            this.stage = new Cesium.PostProcessStage({

                fragmentShader: SSRT_SHADER,

                uniforms: {

                    isEnabled: () => this.state.isEnabled,

                    smoothNormals: () => this.state.smoothNormals,

                    strength: () => this.state.strength,

                    reflectivity: () => this.state.reflectivity,

                    maxSearchDistance: () => this.state.maxDist

                }

            });

            this.stage.selected = [model];

            geofs.api.viewer.scene.postProcessStages.add(this.stage);

            this.lastModel = model;

        }



        ui() {

            const target = document.querySelector('.geofs-preference-list .geofs-advanced .geofs-stopMousePropagation');

            if (!target || document.getElementById('ssrt-ui')) return;



            const uiHTML = `

                <div id="ssrt-ui" style="border-top: 1px solid #555; margin-top: 10px; padding-top: 10px;">

                    <h5 style="color: #00d4ff; font-weight: bold;">Better Lighting</h5>

                    <div class="geofs-option"><span>Enabled</span><label class="mdl-switch mdl-js-switch" for="s1"><input id="s1" type="checkbox" class="mdl-switch__input" checked></label></div>

                    <div class="geofs-option"><span>Strength</span><input id="sl_str" type="range" class="mdl-slider" min="0" max="1" step="0.01" value="${this.state.strength}"></div>

                    <div class="geofs-option"><span>Glossiness</span><input id="sl_ref" type="range" class="mdl-slider" min="0" max="1" step="0.01" value="${this.state.reflectivity}"></div>

                </div>

            `;

            target.insertAdjacentHTML('beforeend', uiHTML);

            document.getElementById('s1').onchange = (e) => this.state.isEnabled = e.target.checked;

            document.getElementById('sl_str').oninput = (e) => this.state.strength = parseFloat(e.target.value);

            document.getElementById('sl_ref').oninput = (e) => this.state.reflectivity = parseFloat(e.target.value);

            if (window.componentHandler) window.componentHandler.upgradeElements(document.getElementById('ssrt-ui'));

        }

    }



    if (window.geofs) new SSRTManager().init();

})();

