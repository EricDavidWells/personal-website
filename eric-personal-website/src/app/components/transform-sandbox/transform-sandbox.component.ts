import { Component, OnInit, AfterViewInit, OnDestroy, ElementRef, ViewChild, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

const DEFAULT_TRANSFORM_CODE = `function transform() {
  // Available:
  //   THREE  (Matrix4, Vector3, Quaternion, Euler, MathUtils)
  //   Math   (cos, sin, PI, etc.)
  //   getWorldTransform("frame_name")  -> Matrix4
  
  const T = new THREE.Matrix4();
  T.makeRotationZ(Math.PI / 4);
  T.setPosition(1, 0, 0.5);
  return T;
}`;

export interface CoordinateFrame {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  axesLength: number;
  lineRadius: number;
  parentId: string | null;
  transformCode: string;
  transformMode: 'simple' | 'code';
}

interface FrameSceneObject {
  group: THREE.Group;
  axesGroup: THREE.Group;
  label: CSS2DObject;
}

interface AnimationState {
  frameId: string;
  startPosition: THREE.Vector3;
  endPosition: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  endQuaternion: THREE.Quaternion;
  progress: number;
  duration: number;
  returning: boolean;
}

@Component({
  selector: 'app-transform-sandbox',
  imports: [FormsModule, CommonModule],
  templateUrl: './transform-sandbox.component.html',
  styleUrl: './transform-sandbox.component.css'
})
export class TransformSandboxComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('sceneContainer', { static: false }) sceneContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('sandboxLayout', { static: false }) sandboxLayout!: ElementRef<HTMLDivElement>;

  project: Project | undefined;
  frames: CoordinateFrame[] = [];
  selectedFrameId: string | null = null;
  animationDuration = 1.0;
  codeError: string | null = null;
  dragOverIndex: number | null = null;
  gizmoEnabled = true;
  gizmoMode: 'translate' | 'rotate' = 'translate';
  private dragFromIndex: number | null = null;

  private isBrowser: boolean;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private labelRenderer!: CSS2DRenderer;
  private controls!: OrbitControls;
  private gizmo!: TransformControls;
  private frameObjects = new Map<string, FrameSceneObject>();
  private compiledCode = new Map<string, { code: string; fn: Function }>();
  private animationState: AnimationState | null = null;
  private animFrameId = 0;
  private resizeObserver!: ResizeObserver;
  private nextFrameNumber = 1;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  get selectedFrame(): CoordinateFrame | undefined {
    return this.frames.find(f => f.id === this.selectedFrameId);
  }

  get availableParents(): CoordinateFrame[] {
    if (!this.selectedFrameId) return [];
    return this.frames.filter(f => f.id !== this.selectedFrameId && !this.isDescendantOf(f.id, this.selectedFrameId!));
  }

  get isAnimating(): boolean {
    return this.animationState !== null;
  }

  ngOnInit(): void {
    this.project = PROJECTS.find(p => p.slug === 'transform-sandbox');
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    this.initScene();
    this.animate();
  }

  ngOnDestroy(): void {
    if (!this.isBrowser) return;
    cancelAnimationFrame(this.animFrameId);
    this.resizeObserver?.disconnect();
    this.gizmo?.detach();
    this.gizmo?.dispose();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.labelRenderer?.domElement.remove();

    this.frameObjects.forEach(obj => {
      obj.label.element.remove();
      obj.group.removeFromParent();
    });
  }

  addFrame(): void {
    const id = crypto.randomUUID();
    const name = `frame_${this.nextFrameNumber++}`;
    const frame: CoordinateFrame = {
      id,
      name,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      axesLength: 1,
      lineRadius: 0.02,
      parentId: null,
      transformCode: DEFAULT_TRANSFORM_CODE,
      transformMode: 'simple',
    };
    this.frames.push(frame);
    this.addFrameToScene(frame);
    this.selectedFrameId = id;
    this.updateGizmos();
  }

  removeFrame(id: string): void {
    const children = this.frames.filter(f => f.parentId === id);
    children.forEach(child => {
      child.parentId = null;
      this.reparentInScene(child);
    });

    this.frames = this.frames.filter(f => f.id !== id);
    this.removeFrameFromScene(id);
    this.compiledCode.delete(id);

    if (this.selectedFrameId === id) {
      this.selectedFrameId = this.frames.length > 0 ? this.frames[0].id : null;
    }
    this.updateGizmos();
  }

  selectFrame(id: string): void {
    this.selectedFrameId = id;
    this.updateGizmos();
  }

  onFramePropertyChange(frame: CoordinateFrame): void {
    this.updateFrameInScene(frame);
  }

  onModeChange(frame: CoordinateFrame, mode: 'simple' | 'code'): void {
    if (frame.transformMode === 'code' && mode === 'simple') {
      const obj = this.frameObjects.get(frame.id);
      if (obj) {
        const pos = obj.group.position;
        const euler = new THREE.Euler().setFromQuaternion(obj.group.quaternion);
        frame.position = { x: pos.x, y: pos.y, z: pos.z };
        frame.rotation = {
          x: THREE.MathUtils.radToDeg(euler.x),
          y: THREE.MathUtils.radToDeg(euler.y),
          z: THREE.MathUtils.radToDeg(euler.z),
        };
      }
    }
    frame.transformMode = mode;
    this.codeError = null;
    this.updateGizmos();
  }

  onGizmoEnabledChange(): void {
    this.updateGizmos();
  }

  onGizmoModeChange(mode: 'translate' | 'rotate'): void {
    this.gizmoMode = mode;
    if (this.gizmo) this.gizmo.setMode(mode);
  }

  onParentChange(frame: CoordinateFrame): void {
    this.reparentInScene(frame);
    this.updateFrameInScene(frame);
  }

  onDragStart(index: number): void {
    this.dragFromIndex = index;
  }

  onDragOver(event: DragEvent, index: number): void {
    event.preventDefault();
    this.dragOverIndex = index;
  }

  onDragLeave(): void {
    this.dragOverIndex = null;
  }

  onDrop(toIndex: number): void {
    if (this.dragFromIndex !== null && this.dragFromIndex !== toIndex) {
      const [moved] = this.frames.splice(this.dragFromIndex, 1);
      this.frames.splice(toIndex, 0, moved);
    }
    this.dragFromIndex = null;
    this.dragOverIndex = null;
  }

  onDragEnd(): void {
    this.dragFromIndex = null;
    this.dragOverIndex = null;
  }

  onDividerMouseDown(event: MouseEvent): void {
    event.preventDefault();
    const layout = this.sandboxLayout.nativeElement;
    const scene = this.sceneContainer.nativeElement;

    const onMouseMove = (e: MouseEvent) => {
      const layoutRect = layout.getBoundingClientRect();
      const sceneWidth = e.clientX - layoutRect.left - 12;
      const minWidth = 200;
      const maxWidth = layoutRect.width - minWidth - 30;
      scene.style.flex = 'none';
      scene.style.width = Math.max(minWidth, Math.min(maxWidth, sceneWidth)) + 'px';
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  private updateGizmos(): void {
    if (!this.gizmo) return;

    const frame = this.selectedFrame;
    const obj = frame ? this.frameObjects.get(frame.id) : undefined;
    const shouldAttach = !!(frame && obj && frame.transformMode === 'simple' && this.gizmoEnabled);

    if (shouldAttach) {
      this.gizmo.attach(obj!.group);
    } else {
      this.gizmo.detach();
    }
  }

  private syncGizmoToModel(): void {
    const frame = this.selectedFrame;
    if (!frame) return;
    const obj = this.frameObjects.get(frame.id);
    if (!obj) return;

    const pos = obj.group.position;
    const euler = new THREE.Euler().setFromQuaternion(obj.group.quaternion);
    frame.position = { x: pos.x, y: pos.y, z: pos.z };
    frame.rotation = {
      x: THREE.MathUtils.radToDeg(euler.x),
      y: THREE.MathUtils.radToDeg(euler.y),
      z: THREE.MathUtils.radToDeg(euler.z),
    };
  }

  private evalTransformCode(frame: CoordinateFrame): THREE.Matrix4 | null {
    const getWorldTransform = (name: string): THREE.Matrix4 => {
      const target = this.frames.find(f => f.name === name);
      if (!target) throw new Error(`Frame "${name}" not found`);
      const obj = this.frameObjects.get(target.id);
      if (!obj) throw new Error(`Frame "${name}" has no scene object`);
      obj.group.updateWorldMatrix(true, false);
      return obj.group.matrixWorld.clone();
    };

    let cached = this.compiledCode.get(frame.id);
    if (!cached || cached.code !== frame.transformCode) {
      const fn = new Function('THREE', 'Math', 'getWorldTransform', frame.transformCode + '\nreturn transform();');
      cached = { code: frame.transformCode, fn };
      this.compiledCode.set(frame.id, cached);
    }

    const result = cached.fn(THREE, Math, getWorldTransform);
    if (!(result instanceof THREE.Matrix4)) {
      this.codeError = 'Code must return a THREE.Matrix4';
      return null;
    }
    return result;
  }

  private evaluateLiveCodeFrames(): void {
    for (const frame of this.frames) {
      if (frame.transformMode !== 'code') continue;
      if (this.animationState?.frameId === frame.id) continue;
      const isSelected = frame.id === this.selectedFrameId;
      try {
        const result = this.evalTransformCode(frame);
        if (!result) continue;

        const obj = this.frameObjects.get(frame.id);
        if (!obj) continue;

        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        result.decompose(pos, quat, scale);

        obj.group.position.copy(pos);
        obj.group.quaternion.copy(quat);
        if (isSelected) this.codeError = null;
      } catch (e: any) {
        if (isSelected) this.codeError = e.message || String(e);
      }
    }
  }

  exportScene(): void {
    const json = JSON.stringify(this.frames, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transform-sandbox.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  importScene(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    file.text().then(text => {
      const imported: CoordinateFrame[] = JSON.parse(text);
      this.clearScene();
      // Add frames in dependency order: parents before children
      const added = new Set<string>();
      const pending = [...imported];
      while (pending.length > 0) {
        const before = pending.length;
        for (let i = pending.length - 1; i >= 0; i--) {
          const frame = pending[i];
          if (frame.parentId === null || added.has(frame.parentId)) {
            this.frames.push(frame);
            this.addFrameToScene(frame);
            if (frame.parentId) this.reparentInScene(frame);
            added.add(frame.id);
            pending.splice(i, 1);
          }
        }
        if (pending.length === before) {
          // Remaining frames have broken parent refs — add as root
          pending.forEach(frame => {
            frame.parentId = null;
            this.frames.push(frame);
            this.addFrameToScene(frame);
            added.add(frame.id);
          });
          break;
        }
      }
      this.selectedFrameId = this.frames.length > 0 ? this.frames[0].id : null;
      this.nextFrameNumber = this.frames.length + 1;
      this.updateGizmos();
      input.value = '';
    });
  }

  private clearScene(): void {
    this.animationState = null;
    this.selectedFrameId = null;
    this.updateGizmos();
    [...this.frames].forEach(f => {
      this.removeFrameFromScene(f.id);
    });
    this.frames = [];
    this.compiledCode.clear();
  }

  animateFromParent(): void {
    if (!this.selectedFrame || this.isAnimating) return;

    const frameObj = this.frameObjects.get(this.selectedFrame.id);
    if (!frameObj) return;

    // End pose: the frame's actual world position
    const endPos = new THREE.Vector3();
    frameObj.group.getWorldPosition(endPos);
    const endQuat = new THREE.Quaternion();
    frameObj.group.getWorldQuaternion(endQuat);

    // Start pose: the parent's world position (or world origin for root frames)
    const startPos = new THREE.Vector3();
    const startQuat = new THREE.Quaternion();
    if (this.selectedFrame.parentId) {
      const parentObj = this.frameObjects.get(this.selectedFrame.parentId);
      if (parentObj) {
        parentObj.group.getWorldPosition(startPos);
        parentObj.group.getWorldQuaternion(startQuat);
      }
    }

    this.animationState = {
      frameId: this.selectedFrame.id,
      startPosition: startPos,
      endPosition: endPos,
      startQuaternion: startQuat,
      endQuaternion: endQuat,
      progress: 0,
      duration: this.animationDuration,
      returning: false,
    };
  }

  // --- Three.js setup ---

  private initScene(): void {
    const container = this.sceneContainer.nativeElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(4, -4, 3);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.left = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.labelRenderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.mouseButtons = {
      LEFT: null as any,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.zoomToCursor = true;

    // Grid on the XY plane (Z-up)
    const grid = new THREE.GridHelper(10, 10, 0x444466, 0x333355);
    grid.rotation.x = Math.PI / 2;
    this.scene.add(grid);

    const worldAxes = this.createAxesCylinders(1.5, 0.03);
    this.scene.add(worldAxes);
    const worldLabel = this.createLabel('world');
    worldAxes.add(worldLabel);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(5, -5, 10);
    this.scene.add(dirLight);

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setMode(this.gizmoMode);
    this.gizmo.setSpace('local');
    this.scene.add(this.gizmo.getHelper());

    this.gizmo.addEventListener('dragging-changed', (event: any) => {
      this.controls.enabled = !event.value;
    });
    this.gizmo.addEventListener('objectChange', () => this.syncGizmoToModel());

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.onResize();
  }

  private animate(): void {
    this.animFrameId = requestAnimationFrame(() => this.animate());

    if (this.animationState) {
      this.tickAnimation();
    }

    this.evaluateLiveCodeFrames();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  private tickAnimation(): void {
    if (!this.animationState) return;

    const dt = 1 / 60;
    this.animationState.progress += dt / this.animationState.duration;

    if (this.animationState.progress >= 1) {
      this.animationState.progress = 1;
    }

    const t = this.easeInOutCubic(this.animationState.progress);
    const obj = this.frameObjects.get(this.animationState.frameId);
    if (obj) {
      const pos = new THREE.Vector3().lerpVectors(
        this.animationState.startPosition,
        this.animationState.endPosition,
        t
      );
      const quat = new THREE.Quaternion().slerpQuaternions(
        this.animationState.startQuaternion,
        this.animationState.endQuaternion,
        t
      );

      // Convert world-space interpolated pose back to local space
      const parent = obj.group.parent;
      if (parent) {
        const parentWorldQuat = new THREE.Quaternion();
        parent.getWorldQuaternion(parentWorldQuat);
        const parentWorldPos = new THREE.Vector3();
        parent.getWorldPosition(parentWorldPos);

        const parentWorldQuatInv = parentWorldQuat.clone().invert();
        const localPos = pos.clone().sub(parentWorldPos).applyQuaternion(parentWorldQuatInv);
        const localQuat = parentWorldQuatInv.clone().multiply(quat);

        obj.group.position.copy(localPos);
        obj.group.quaternion.copy(localQuat);
      } else {
        obj.group.position.copy(pos);
        obj.group.quaternion.copy(quat);
      }
    }

    if (this.animationState.progress >= 1) {
      if (!this.animationState.returning) {
        // Reverse direction for the return trip
        const { startPosition, endPosition, startQuaternion, endQuaternion } = this.animationState;
        this.animationState.startPosition = endPosition;
        this.animationState.endPosition = startPosition;
        this.animationState.startQuaternion = endQuaternion;
        this.animationState.endQuaternion = startQuaternion;
        this.animationState.progress = 0;
        this.animationState.returning = true;
      } else {
        const frame = this.frames.find(f => f.id === this.animationState!.frameId);
        if (frame && obj) {
          this.updateFrameInScene(frame);
        }
        this.animationState = null;
      }
    }
  }

  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  private onResize(): void {
    const container = this.sceneContainer.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
  }

  private addFrameToScene(frame: CoordinateFrame): void {
    const group = new THREE.Group();
    const axesGroup = this.createAxesCylinders(frame.axesLength, frame.lineRadius);
    group.add(axesGroup);

    const label = this.createLabel(frame.name);
    group.add(label);

    this.applyTransform(group, frame);
    this.scene.add(group);

    this.frameObjects.set(frame.id, { group, axesGroup, label });
  }

  private removeFrameFromScene(id: string): void {
    const obj = this.frameObjects.get(id);
    if (!obj) return;
    obj.label.element.remove();
    this.disposeAxesGroup(obj.axesGroup);
    obj.group.removeFromParent();
    this.frameObjects.delete(id);
  }

  private updateFrameInScene(frame: CoordinateFrame): void {
    const obj = this.frameObjects.get(frame.id);
    if (!obj) return;
    this.applyTransform(obj.group, frame);
    obj.label.element.textContent = frame.name;
    this.rebuildAxes(obj, frame);
  }

  private rebuildAxes(obj: FrameSceneObject, frame: CoordinateFrame): void {
    obj.group.remove(obj.axesGroup);
    this.disposeAxesGroup(obj.axesGroup);
    obj.axesGroup = this.createAxesCylinders(frame.axesLength, frame.lineRadius);
    obj.group.add(obj.axesGroup);
  }

  private disposeAxesGroup(group: THREE.Group): void {
    group.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
  }

  private reparentInScene(frame: CoordinateFrame): void {
    const obj = this.frameObjects.get(frame.id);
    if (!obj) return;

    obj.group.removeFromParent();

    if (frame.parentId) {
      const parentObj = this.frameObjects.get(frame.parentId);
      if (parentObj) {
        parentObj.group.add(obj.group);
      } else {
        this.scene.add(obj.group);
      }
    } else {
      this.scene.add(obj.group);
    }
  }

  private applyTransform(group: THREE.Group, frame: CoordinateFrame): void {
    group.position.set(frame.position.x, frame.position.y, frame.position.z);
    group.rotation.set(
      THREE.MathUtils.degToRad(frame.rotation.x),
      THREE.MathUtils.degToRad(frame.rotation.y),
      THREE.MathUtils.degToRad(frame.rotation.z),
    );
  }

  private createAxesCylinders(length: number, radius: number): THREE.Group {
    const group = new THREE.Group();
    const axes: [THREE.Vector3, number][] = [
      [new THREE.Vector3(1, 0, 0), 0xff4444],
      [new THREE.Vector3(0, 1, 0), 0x44cc44],
      [new THREE.Vector3(0, 0, 1), 0x4488ff],
    ];

    for (const [dir, color] of axes) {
      const geo = new THREE.CylinderGeometry(radius, radius, length, 8);
      geo.translate(0, length / 2, 0);
      // Rotate cylinder from default Y-axis to target axis
      if (dir.x === 1) geo.rotateZ(-Math.PI / 2);
      else if (dir.z === 1) geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ color });
      group.add(new THREE.Mesh(geo, mat));
    }
    return group;
  }

  private createLabel(text: string): CSS2DObject {
    const div = document.createElement('div');
    div.textContent = text;
    div.style.color = '#ffffff';
    div.style.fontFamily = 'var(--font), monospace';
    div.style.fontSize = '12px';
    div.style.padding = '2px 6px';
    div.style.background = 'rgba(0, 0, 0, 0.6)';
    div.style.borderRadius = '3px';
    div.style.whiteSpace = 'nowrap';
    const label = new CSS2DObject(div);
    label.position.set(0, 0.15, 0);
    return label;
  }

  private isDescendantOf(frameId: string, potentialAncestorId: string): boolean {
    const frame = this.frames.find(f => f.id === frameId);
    if (!frame || !frame.parentId) return false;
    if (frame.parentId === potentialAncestorId) return true;
    return this.isDescendantOf(frame.parentId, potentialAncestorId);
  }
}
