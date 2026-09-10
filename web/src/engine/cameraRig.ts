import {
  ArcRotateCamera,
  UniversalCamera,
  Vector3,
  type Scene,
} from "@babylonjs/core";

/**
 * Third-person orbit camera (ArcRotateCamera) with a first-person toggle
 * (UniversalCamera). Mouse drag rotates, wheel zooms; `V` toggles (handled in
 * Game). The first-person camera's own WASD input is stripped so movement keys
 * only ever drive the avatar.
 */
export class CameraRig {
  private readonly arc: ArcRotateCamera;
  private readonly fps: UniversalCamera;
  firstPerson = false;

  constructor(
    private readonly scene: Scene,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.arc = new ArcRotateCamera(
      "arc",
      -Math.PI / 2,
      1.05,
      9,
      new Vector3(0, 1.4, 0),
      scene,
    );
    this.arc.lowerRadiusLimit = 3.5;
    this.arc.upperRadiusLimit = 18;
    this.arc.lowerBetaLimit = 0.25;
    this.arc.upperBetaLimit = 1.45;
    this.arc.wheelDeltaPercentage = 0.02;
    this.arc.panningSensibility = 0; // keep the avatar centred in Phase 0
    this.arc.minZ = 0.1;

    this.fps = new UniversalCamera("fps", new Vector3(0, 1.5, 0), scene);
    this.fps.minZ = 0.05;
    this.fps.fov = 0.9;
    this.fps.speed = 0;
    this.fps.inertia = 0.35;
    this.fps.angularSensibility = 900;
    this.fps.inputs.removeByType("FreeCameraKeyboardMoveInput");

    scene.activeCamera = this.arc;
    this.arc.attachControl(canvas, true);
  }

  setFirstPerson(on: boolean): void {
    if (on === this.firstPerson) return;
    this.firstPerson = on;

    if (on) {
      this.arc.detachControl();
      const dir = this.forwardXZ();
      this.fps.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
      this.scene.activeCamera = this.fps;
      this.fps.attachControl(this.canvas, true);
    } else {
      this.fps.detachControl();
      this.scene.activeCamera = this.arc;
      this.arc.attachControl(this.canvas, true);
    }
  }

  /** Active camera forward, projected onto the ground plane and normalised. */
  forwardXZ(): Vector3 {
    const cam = this.firstPerson ? this.fps : this.arc;
    const f = cam.getForwardRay().direction;
    const v = new Vector3(f.x, 0, f.z);
    if (v.lengthSquared() < 1e-6) v.set(0, 0, 1);
    return v.normalize();
  }

  yaw(): number {
    const v = this.forwardXZ();
    return Math.atan2(v.x, v.z);
  }

  update(eye: Vector3, head: Vector3, dt: number): void {
    if (this.firstPerson) {
      this.fps.position.copyFrom(eye);
    } else {
      Vector3.LerpToRef(this.arc.target, head, 1 - Math.exp(-10 * dt), this.arc.target);
    }
  }
}
