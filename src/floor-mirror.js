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
