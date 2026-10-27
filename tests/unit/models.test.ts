import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HAND_PRESETS } from '@/lib/hands';
import { loadModelFile } from '@/lib/assetstore';
import { Fitted, MissingBones, ModelRig, importModel, mapBones, missingBones } from '@/lib/model';
import { SceneView } from '@/lib/sceneview';
import { Store } from '@/lib/store';
import { withAngles } from '@/lib/pose';
import { Rig } from '@/lib/relations';
import { newFigure } from '@/lib/doc';
import type { ModelInfo } from '@/lib/types';
import { characterGltf } from '../fixtures/gltf';
import { mixamoRig } from '../fixtures/rig';
import { MemoryStorage } from '../fixtures/scenes';

const angleBetween = (a: THREE.Vector3, b: THREE.Vector3) => (a.angleTo(b) * 180) / Math.PI;

describe('models: characters from other tools fitted to the skeleton', () => {
  it('finds which bone is which: limbs, spine, shoulders, toes and fingers', () => {
    const map = mapBones(mixamoRig());
    expect(missingBones(map)).toEqual([]);
    expect(map).toMatchObject({
      hips: 'mixamorig:Hips', spine: 'mixamorig:Spine', chest: 'mixamorig:Spine1', upperChest: 'mixamorig:Spine2', neck: 'mixamorig:Neck', head: 'mixamorig:Head',
      leftShoulder: 'mixamorig:LeftShoulder', leftUpperArm: 'mixamorig:LeftArm', leftLowerArm: 'mixamorig:LeftForeArm', leftHand: 'mixamorig:LeftHand',
      rightUpperLeg: 'mixamorig:RightUpLeg', rightLowerLeg: 'mixamorig:RightLeg', rightFoot: 'mixamorig:RightFoot', rightToes: 'mixamorig:RightToeBase',
      leftThumbMetacarpal: 'mixamorig:LeftHandThumb1', leftIndexProximal: 'mixamorig:LeftHandIndex1', leftLittleDistal: 'mixamorig:LeftHandPinky3',
    });
  });

  it('reads an A-pose as arms 45° down, and stands any rig up facing +Z', () => {
    const rig = mixamoRig(true);
    // Lying on its back in the file, its head to −Z: stood up all the same.
    rig.rotation.x = -Math.PI / 2;
    rig.updateMatrixWorld(true);
    const fitted = new Fitted(rig, mapBones(rig));
    const world = fitted.read();
    const arm = new THREE.Vector3(1, 0, 0).applyQuaternion(world.get('leftUpperArm')!);
    expect(angleBetween(arm, new THREE.Vector3(1, -1, 0).normalize())).toBeLessThan(1);
    expect(angleBetween(new THREE.Vector3(0, 1, 0).applyQuaternion(world.get('spine')!), new THREE.Vector3(0, 1, 0))).toBeLessThan(1);
    expect(fitted.at('head')!.y).toBeGreaterThan(fitted.at('hips')!.y);
    expect(fitted.at('leftUpperLeg')!.x).toBeGreaterThan(fitted.at('rightUpperLeg')!.x);
  });

  for (const aPose of [false, true]) {
    it(`poses a ${aPose ? 'A' : 'T'}-posed character as the mannequin is posed, at its place and size`, () => {
      const rig = mixamoRig(aPose);
      const info: ModelInfo = { id: 'm', name: 'Character', format: 'glb', bones: mapBones(rig) };
      const model = new ModelRig(rig, info);
      const f = { ...newFigure(), position: [1, 0.95, 2] as [number, number, number], bones: withAngles(newFigure().bones, { leftUpperArm: [-60, 20, 40], leftLowerArm: [-70, 0, 0], rightUpperLeg: [-50, 0, -10], rightLowerLeg: [80, 0, 0], spine: [15, 10, 0], hips: [0, 35, 0] }) };
      const mannequin = new Rig().model(f);
      const hips = mannequin.joints.hips.getWorldPosition(new THREE.Vector3());
      model.apply(f, hips);
      const bone = (n: string) => model.object.getObjectByName(`mixamorig:${n}`)!.getWorldPosition(new THREE.Vector3());
      const joint = (j: 'leftUpperArm' | 'leftLowerArm' | 'leftHand' | 'rightUpperLeg' | 'rightLowerLeg' | 'rightFoot') => mannequin.joints[j].getWorldPosition(new THREE.Vector3());
      expect(bone('Hips').distanceTo(hips)).toBeLessThan(1e-3);
      for (const [[a, b], [p, q]] of [[['LeftArm', 'LeftForeArm'], ['leftUpperArm', 'leftLowerArm']], [['LeftForeArm', 'LeftHand'], ['leftLowerArm', 'leftHand']], [['RightUpLeg', 'RightLeg'], ['rightUpperLeg', 'rightLowerLeg']], [['RightLeg', 'RightFoot'], ['rightLowerLeg', 'rightFoot']]] as const) {
        expect(angleBetween(bone(b).sub(bone(a)), joint(q).sub(joint(p))), `${a}→${b}`).toBeLessThan(3);
      }
      // Its size: the hips as high above the ankles as the mannequin's (so the feet reach the floor).
      expect(model.object.scale.x * 95).toBeCloseTo(0.83, 1);
    });
  }

  it('curls a character\'s fingers as the hand presets have them', () => {
    const rig = mixamoRig();
    const model = new ModelRig(rig, { id: 'm', name: 'C', format: 'glb', bones: mapBones(rig) });
    const tip = (hand: string) => {
      const f = newFigure();
      const fig = { ...f, hands: { ...f.hands, L: HAND_PRESETS.find((p) => p.name === hand)!.hand } };
      model.apply(fig, new THREE.Vector3(0, 0.95, 0));
      const w = model.object.getObjectByName('mixamorig:LeftHand')!.getWorldPosition(new THREE.Vector3());
      return model.object.getObjectByName('mixamorig:LeftHandIndex3')!.getWorldPosition(new THREE.Vector3()).sub(w);
    };
    // Towards the palm (down, in the T-pose).
    expect(tip('Fist').length()).toBeLessThan(tip('Open').length() * 0.8);
    expect(tip('Fist').y).toBeLessThan(-0.02);
  });

  it('imports a character from a glTF file: its bones found, its file kept, drawn for a figure', async () => {
    const data = new TextEncoder().encode(characterGltf(true)).buffer as ArrayBuffer;
    const info = await importModel('Hero_Character.gltf', data);
    expect(info).toMatchObject({ name: 'Hero Character', format: 'glb' });
    expect(missingBones(info.bones)).toEqual([]);
    expect(await loadModelFile(info.id)).toBe(data);
    const store = new Store(new MemoryStorage());
    store.commit((lib) => ({ ...lib, models: [info] }));
    const f = store.figure!;
    store.updateFigure(f.id, (x) => ({ ...x, model: info.id }));
    const sv = new SceneView();
    sv.sync(store.scene);
    const rig = sv.models.get(f.id)!;
    expect(rig).toBeDefined();
    expect(sv.figures.get(f.id)!.object.visible).toBe(false);
    // Its hips where the mannequin's are; its feet near the floor.
    const hips = sv.figures.get(f.id)!.joints.hips.getWorldPosition(new THREE.Vector3());
    // (glTF keeps names to what animation paths allow: "mixamorigHips")
    expect(info.bones.hips).toBe('mixamorigHips');
    expect(rig.object.getObjectByName(info.bones.hips!)!.getWorldPosition(new THREE.Vector3()).distanceTo(hips)).toBeLessThan(1e-3);
    expect(Math.abs(rig.object.getObjectByName(info.bones.leftFoot!)!.getWorldPosition(new THREE.Vector3()).y - sv.figures.get(f.id)!.joints.leftFoot.getWorldPosition(new THREE.Vector3()).y)).toBeLessThan(0.05);
    sv.dispose();
  });

  it('says which bones it could not find, to map them by hand', async () => {
    const text = characterGltf().replaceAll('mixamorig:LeftHand"', 'mixamorig:Thing"');
    const err = await importModel('x.gltf', new TextEncoder().encode(text).buffer as ArrayBuffer).catch((e) => e);
    expect(err).toBeInstanceOf(MissingBones);
    expect(err.missing).toContain('leftHand');
    expect(err.names).toContain('mixamorigThing');
    // Mapped by hand: imported.
    const info = await importModel('x.gltf', new TextEncoder().encode(text).buffer as ArrayBuffer, { ...err.found, leftHand: 'mixamorigThing', leftLowerArm: 'mixamorigLeftForeArm', leftUpperArm: 'mixamorigLeftArm' });
    expect(info.bones.leftHand).toBe('mixamorigThing');
  });
});
