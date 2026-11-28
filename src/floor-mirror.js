// Freestanding arched brass cheval floor mirror with real-time planar reflection.
// On WebGPU, upgrades the glass to Three.js TSL reflector() (true live planar reflection of Reverie and the room).
// On WebGL, upgrades to Three.js Reflector (planar mirror) with v.reflect() SSR as immediate fallback.
import gs from '../engine/src/gamescroll.js';

function archShape(THREE, w, h) {
  const sh = new THREE.Shape(), hw = w / 2, hh = h / 2, r = hw;
  sh.moveTo(-hw, -hh);
  sh.lineTo(hw, -hh);
  sh.lineTo(hw, hh - r);
  sh.absarc(0, hh - r, r, 0, Math.PI, false);
  sh.lineTo(-hw, -hh);
  return sh;
}

/**
 * Builds a freestanding arched brass cheval mirror resting flush on the floor (y = 0).
 * Returns { group, glass, upgrade(v) } where upgrade(v) swaps the glass to a live planar reflector once backend is known.
 */
export function makeFloorMirror({ brassMat, woodMat, x = -1.05, z = -.42, ry = .80 }) {
  const { THREE, pbr, rbox } = gs.hd;
  const group = new THREE.Group();
  group.name = 'floor-mirror';
  group.position.set(x, 0, z);
  group.rotation.y = ry;

  const standW = .255; // half-width between the two side uprights
  // Two low oak sled feet resting flush on the floor (y = 0 .. 0.024)
  for (const side of [-1, 1]) {
    const foot = new THREE.Mesh(rbox(.038, .024, .32, .008), woodMat);
    foot.position.set(side * standW, .012, 0);
    foot.castShadow = true; foot.receiveShadow = true;
    group.add(foot);

    // Slim vertical brushed-brass upright rising from each foot
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.0105, .012, .56, 12), brassMat);
    post.position.set(side * standW, .30, 0);
    post.castShadow = true; post.receiveShadow = true;
    group.add(post);

    // Small brass finial cap atop each upright
    const finial = new THREE.Mesh(new THREE.SphereGeometry(.0155, 14, 12), brassMat);
    finial.position.set(side * standW, .585, 0);
    group.add(finial);

    // Brass pivot knob connecting the upright to the mirror frame
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(.013, .013, .036, 12), brassMat);
    knob.rotation.z = Math.PI / 2;
    knob.position.set(side * (standW - .01), .52, 0);
    group.add(knob);
  }

  // Rear horizontal crossbar tying the two uprights together cleanly
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(.0085, .0085, standW * 2, 10), brassMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, .09, -.055);
  bar.castShadow = true;
  group.add(bar);

  // Tilted mirror body pivoted at y = 0.52 (tilted ~5° back like a real cheval dressing mirror)
  const pivot = new THREE.Group();
  pivot.position.set(0, .52, 0);
  pivot.rotation.x = -.09;
  group.add(pivot);

  const glassGeo = new THREE.ShapeGeometry(archShape(THREE, .42, .80), 28);
  const fallbackMat = pbr('#eef2f6', { metal: .99, rough: .01, clear: .25 });
  const glass = new THREE.Mesh(glassGeo, fallbackMat);
  glass.name = 'floor-mirror-glass';
  glass.position.z = .017;
  glass.userData.noTrace = true;
  glass.castShadow = false;
  glass.receiveShadow = false;

  const frameOuter = archShape(THREE, .466, .846);
  frameOuter.holes.push(archShape(THREE, .416, .796));
  const frameGeo = new THREE.ExtrudeGeometry(frameOuter, {
    depth: .024, bevelEnabled: true, bevelThickness: .005, bevelSize: .005, bevelSegments: 2, curveSegments: 24,
  });
  const frame = new THREE.Mesh(frameGeo, brassMat);
  frame.castShadow = true; frame.receiveShadow = true;

  const back = new THREE.Mesh(new THREE.ShapeGeometry(archShape(THREE, .45, .83), 24), woodMat);
  back.position.z = -.002;
  back.rotation.y = Math.PI;
  back.castShadow = true; back.receiveShadow = true;

  pivot.add(back, frame, glass);

  let state = 'init'; // 'init' | 'loading' | 'done'
  function upgrade(v) {
    if (state !== 'init' || !v?.drew) return;
    state = 'loading';
    import('../engine/src/kit/hd3d.js').then(async ({ HD }) => {
      const backend = HD?.info?.backend;
      if (!backend) { state = 'init'; return; }
      if (backend === 'webgpu') {
        try {
          const [{ MeshBasicNodeMaterial }, { reflector, vec3 }] = await Promise.all([
            import('../engine/node_modules/three/build/three.webgpu.js'),
            import('../engine/node_modules/three/build/three.tsl.js'),
          ]);
          const refl = reflector({ resolutionScale: .65, bounces: false });
          glass.add(refl.target);

          // Three.js ReflectorBaseNode uses a forward-depth oblique near-plane clip formula, which inverts the clip
          // plane under HDView's WebGPU reversedDepthBuffer (clipping what's in front of the mirror and showing what's
          // behind it). Patch updateBefore with the exact reversed-depth Lengyel oblique clip (near = 1, far = 0).
          const base = refl.reflector;
          const origUpdateBefore = base.updateBefore.bind(base);
          const _mPos = new THREE.Vector3(), _cPos = new THREE.Vector3(), _norm = new THREE.Vector3();
          const _view = new THREE.Vector3(), _look = new THREE.Vector3(), _targ = new THREE.Vector3();
          const _rotM = new THREE.Matrix4(), _invP = new THREE.Matrix4();
          const _plane = new THREE.Plane(), _C = new THREE.Vector4(), _Q = new THREE.Vector4();
          const _sz = new THREE.Vector2();
          let inMirror = false;

          base.updateBefore = function (frame) {
            const { scene, camera, renderer, material } = frame;
            if (!renderer?.reversedDepthBuffer) return origUpdateBefore(frame);
            if (inMirror) return false;
            inMirror = true;

            const { target } = this;
            const vc = this.getVirtualCamera(camera);
            const rt = this.getRenderTarget(vc);
            renderer.getDrawingBufferSize(_sz);
            this._updateResolution(rt, renderer);

            target.updateWorldMatrix(true, false);
            _mPos.setFromMatrixPosition(target.matrixWorld);
            _cPos.setFromMatrixPosition(camera.matrixWorld);
            _rotM.extractRotation(target.matrixWorld);
            _norm.set(0, 0, 1).applyMatrix4(_rotM).normalize();
            _view.subVectors(_mPos, _cPos);

            const facingAway = _view.dot(_norm) > 0;
            if (facingAway && !this.forceUpdate && !this.hasOutput) {
              inMirror = false;
              return;
            }

            _view.reflect(_norm).negate().add(_mPos);
            _rotM.extractRotation(camera.matrixWorld);
            _look.set(0, 0, -1).applyMatrix4(_rotM).add(_cPos);
            _targ.subVectors(_mPos, _look).reflect(_norm).negate().add(_mPos);

            vc.coordinateSystem = camera.coordinateSystem;
            vc._reversedDepth = camera._reversedDepth;
            vc.position.copy(_view);
            vc.up.set(0, 1, 0).applyMatrix4(_rotM).reflect(_norm);
            vc.lookAt(_targ);
            vc.near = camera.near;
            vc.far = camera.far;
            vc.updateMatrixWorld();
            vc.projectionMatrix.copy(camera.projectionMatrix);
            vc.projectionMatrix.elements[8] *= -1;
            vc.projectionMatrix.elements[12] *= -1;

            // Reversed-depth oblique near-plane clip (near = 1, far = 0): row 3 = row 4 - a * C
            _plane.setFromNormalAndCoplanarPoint(_norm, _mPos);
            _plane.applyMatrix4(vc.matrixWorldInverse);
            _C.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
            const p = vc.projectionMatrix.elements;
            _invP.copy(vc.projectionMatrix).invert();
            _Q.set(Math.sign(_C.x), Math.sign(_C.y), 0, 1).applyMatrix4(_invP);
            const wq = p[3] * _Q.x + p[7] * _Q.y + p[11] * _Q.z + p[15] * _Q.w;
            const cq = _C.dot(_Q);
            if (Math.abs(cq) > 1e-6) {
              const a = wq / cq;
              p[2] = -a * _C.x + p[3];
              p[6] = -a * _C.y + p[7];
              p[10] = -a * _C.z + p[11];
              p[14] = -a * _C.w + p[15];
            }
            vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();

            this.textureNode.value = rt.texture;
            if (this.depth) this.textureNode.getDepthNode().value = rt.depthTexture;

            material.visible = false;
            const wasBack = back.visible;
            back.visible = false;
            const curRT = renderer.getRenderTarget();
            const curMRT = renderer.getMRT();
            const curClear = renderer.autoClear;
            const prevName = scene.name;

            renderer.setMRT(null);
            renderer.setRenderTarget(rt);
            renderer.autoClear = true;
            scene.name = (scene.name || 'Scene') + ' [ Reflector ]';

            try {
              if (facingAway && !this.forceUpdate) {
                renderer.clear();
                this.hasOutput = false;
              } else {
                renderer.render(scene, vc);
                this.hasOutput = true;
              }
            } finally {
              scene.name = prevName;
              renderer.setMRT(curMRT);
              renderer.setRenderTarget(curRT);
              renderer.autoClear = curClear;
              back.visible = wasBack;
              material.visible = true;
              inMirror = false;
              this.forceUpdate = false;
            }
          };

          const mat = new MeshBasicNodeMaterial();
          mat.name = 'floor-mirror-reflector';
          mat.colorNode = refl.mul(.92).add(vec3(.018, .022, .026));
          mat.toneMapped = true;
          glass.userData.gsReflect = false;
          glass.userData.noTrace = true;
          glass.material = mat;
          state = 'done';
          return;
        } catch { /* fall through to v.reflect */ }
      } else if (backend === 'webgl') {
        try {
          const { Reflector } = await import('../engine/node_modules/three/examples/jsm/objects/Reflector.js');
          const rMesh = new Reflector(glassGeo, {
            clipBias: .003,
            textureWidth: 512,
            textureHeight: 512,
            color: 0xe8edf2,
          });
          rMesh.position.copy(glass.position);
          rMesh.userData.noTrace = true;
          pivot.remove(glass);
          pivot.add(rMesh);
          state = 'done';
          return;
        } catch { /* fall through */ }
      }
      v?.reflect?.(glass);
      state = 'done';
    }).catch(() => { state = 'done'; });
  }

  return { group, glass, upgrade };
}
