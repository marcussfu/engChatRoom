import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
  type ShadowGenerator,
} from "@babylonjs/core";

export const AVATAR_HEIGHT = 1.7;
export const AVATAR_RADIUS = 0.32;
export const EYE_HEIGHT = 1.5;

/**
 * A placeholder avatar for Phase 0: a coloured capsule body plus a small "nose"
 * box so facing direction is readable. Swapped for a rigged glTF character in a
 * later phase (see docs/PLAN.md §一.A).
 *
 * The returned node's origin sits on the floor; +Z is "forward".
 */
export function createAvatar(
  scene: Scene,
  color: string,
  shadows?: ShadowGenerator,
): TransformNode {
  const root = new TransformNode("avatar", scene);
  const c = Color3.FromHexString(color);

  const bodyMat = new StandardMaterial("avatarBody", scene);
  bodyMat.diffuseColor = c;
  bodyMat.specularColor = new Color3(0.1, 0.1, 0.1);

  const body = MeshBuilder.CreateCapsule(
    "avatarBody",
    { height: AVATAR_HEIGHT, radius: AVATAR_RADIUS, tessellation: 12, subdivisions: 1 },
    scene,
  );
  body.material = bodyMat;
  body.position.y = AVATAR_HEIGHT / 2;
  body.parent = root;

  const noseMat = new StandardMaterial("avatarNose", scene);
  noseMat.diffuseColor = c.scale(0.55);
  const nose = MeshBuilder.CreateBox(
    "avatarNose",
    { width: 0.18, height: 0.18, depth: 0.22 },
    scene,
  );
  nose.material = noseMat;
  nose.position = new Vector3(0, AVATAR_HEIGHT * 0.72, AVATAR_RADIUS + 0.05);
  nose.parent = root;

  if (shadows) {
    shadows.addShadowCaster(body);
    shadows.addShadowCaster(nose);
  }

  return root;
}

/** Re-tint an existing avatar (server assigns our colour only after connect). */
export function setAvatarColor(root: TransformNode, color: string): void {
  const c = Color3.FromHexString(color);
  for (const m of root.getChildMeshes()) {
    const mat = m.material;
    if (mat instanceof StandardMaterial) {
      mat.diffuseColor = m.name.startsWith("avatarNose") ? c.scale(0.55) : c;
    }
  }
}
