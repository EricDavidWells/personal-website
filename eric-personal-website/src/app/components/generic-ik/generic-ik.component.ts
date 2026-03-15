import { Component, OnInit, AfterViewInit, OnDestroy, ElementRef, ViewChild, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

interface JointState {
  name: string;
  value: number;
  lower: number;
  upper: number;
  type: string;
}

interface JointInfo {
  name: string;
  parentLink: string;
  childLink: string;
  type: string;
  lowerLimit: number;
  upperLimit: number;
}

interface KinematicsModule {
  loadUrdfFromString(urdfContent: string): any;
  fkFlat(tree: any, linkName: string): any;
  getJointLimits(tree: any, jointName: string): any;
  getLinkNames(tree: any): any;
  getJointInfo(tree: any): any;
}

const LINK_COLORS = [
  0x4488cc, 0x44aa88, 0xcc8844, 0xaa4488, 0x88aa44, 0x4444cc, 0xcc4444, 0x44ccaa
];

@Component({
  selector: 'app-generic-ik',
  imports: [FormsModule, CommonModule],
  templateUrl: './generic-ik.component.html',
  styleUrl: './generic-ik.component.css'
})
export class GenericIkComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('sceneContainer', { static: false }) sceneContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('viewerLayout', { static: false }) viewerLayout!: ElementRef<HTMLDivElement>;

  project: Project | undefined;
  joints: JointState[] = [];
  loading = true;
  errorMessage: string | null = null;

  private isBrowser: boolean;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private labelRenderer!: CSS2DRenderer;
  private controls!: OrbitControls;
  private animFrameId = 0;
  private resizeObserver!: ResizeObserver;

  private wasmModule: KinematicsModule | null = null;
  private kinematicTree: any = null;
  private linkGroups = new Map<string, THREE.Group>();
  private linkMeshes = new Map<string, THREE.Mesh>();
  private jointInfoList: JointInfo[] = [];

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    this.project = PROJECTS.find(p => p.slug === 'generic-ik');
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    this.initScene();
    this.animate();
    this.loadWasm();
  }

  ngOnDestroy(): void {
    if (!this.isBrowser) return;
    cancelAnimationFrame(this.animFrameId);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.labelRenderer?.domElement.remove();
    this.linkGroups.forEach(group => group.removeFromParent());
  }

  onJointChange(): void {
    if (!this.wasmModule || !this.kinematicTree) return;
    for (const joint of this.joints) {
      this.kinematicTree.updateTheta(joint.name, joint.value);
    }
    this.updateRobotVisualization();
  }

  onDividerMouseDown(event: MouseEvent): void {
    event.preventDefault();
    const layout = this.viewerLayout.nativeElement;
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

  private async loadWasm(): Promise<void> {
    try {
      const wasmUrl = '/assets/wasm/kinematics.js';
      const moduleFactory = (await import(/* @vite-ignore */ wasmUrl)).default;
      this.wasmModule = await moduleFactory();

      const urdfResponse = await fetch('/assets/urdf/ur5.urdf');
      const urdfContent = await urdfResponse.text();
      this.kinematicTree = this.wasmModule!.loadUrdfFromString(urdfContent);

      this.extractJointInfo();
      this.buildRobot();
      this.loading = false;
    } catch (e: any) {
      this.errorMessage = e.message || String(e);
      this.loading = false;
    }
  }

  private extractJointInfo(): void {
    const infoVec = this.wasmModule!.getJointInfo(this.kinematicTree);
    this.jointInfoList = [];
    for (let i = 0; i < infoVec.size(); i++) {
      this.jointInfoList.push(infoVec.get(i));
    }
    infoVec.delete();

    const namesVec = this.kinematicTree.getActiveJointNames();
    this.joints = [];
    for (let i = 0; i < namesVec.size(); i++) {
      const name = namesVec.get(i);
      const limitsVec = this.wasmModule!.getJointLimits(this.kinematicTree, name);
      const lower = limitsVec.get(0);
      const upper = limitsVec.get(1);
      limitsVec.delete();

      const info = this.jointInfoList.find(j => j.name === name);
      this.joints.push({
        name,
        value: 0,
        lower: this.isFiniteLimit(lower) ? lower : -Math.PI,
        upper: this.isFiniteLimit(upper) ? upper : Math.PI,
        type: info?.type || 'unknown'
      });
    }
    namesVec.delete();
  }

  private isFiniteLimit(val: number): boolean {
    return Math.abs(val) < 1e10;
  }

  private buildRobot(): void {
    const linkNamesVec = this.wasmModule!.getLinkNames(this.kinematicTree);
    const linkNames: string[] = [];
    for (let i = 0; i < linkNamesVec.size(); i++) {
      linkNames.push(linkNamesVec.get(i));
    }
    linkNamesVec.delete();

    for (const linkName of linkNames) {
      const group = new THREE.Group();
      group.name = linkName;
      this.scene.add(group);
      this.linkGroups.set(linkName, group);
    }

    // Create cylinder meshes between parent and child links of each joint
    for (let i = 0; i < this.jointInfoList.length; i++) {
      const info = this.jointInfoList[i];
      if (!info.parentLink || !info.childLink) continue;

      const color = LINK_COLORS[i % LINK_COLORS.length];
      const mat = new THREE.MeshStandardMaterial({ color });
      const geo = new THREE.CylinderGeometry(0.04, 0.04, 1, 12);
      const mesh = new THREE.Mesh(geo, mat);
      this.scene.add(mesh);
      this.linkMeshes.set(info.name, mesh);
    }

    // Joint spheres at each active joint
    for (const joint of this.joints) {
      const info = this.jointInfoList.find(j => j.name === joint.name);
      if (!info) continue;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee })
      );
      sphere.name = 'sphere_' + joint.name;
      this.scene.add(sphere);
    }

    // Axes at base and end-effector
    if (linkNames.includes('base_link')) {
      const axes = this.createAxes(0.15);
      const label = this.createLabel('base_link');
      axes.add(label);
      this.linkGroups.get('base_link')!.add(axes);
    }
    if (linkNames.includes('ee_link')) {
      const axes = this.createAxes(0.15);
      const label = this.createLabel('ee_link');
      axes.add(label);
      this.linkGroups.get('ee_link')!.add(axes);
    }

    this.updateRobotVisualization();
  }

  private updateRobotVisualization(): void {
    if (!this.wasmModule || !this.kinematicTree) return;

    // Update link group transforms via FK
    this.linkGroups.forEach((group, linkName) => {
      try {
        const flatVec = this.wasmModule!.fkFlat(this.kinematicTree, linkName);
        const elements: number[] = [];
        for (let i = 0; i < 16; i++) elements.push(flatVec.get(i));
        flatVec.delete();

        const mat4 = new THREE.Matrix4();
        mat4.fromArray(elements);
        group.position.setFromMatrixPosition(mat4);
        group.quaternion.setFromRotationMatrix(mat4);
      } catch {
        // Some links (like 'world') may not have a valid FK chain
      }
    });

    // Position cylinders between connected joints
    for (const info of this.jointInfoList) {
      const mesh = this.linkMeshes.get(info.name);
      if (!mesh) continue;

      const parentGroup = this.linkGroups.get(info.parentLink);
      const childGroup = this.linkGroups.get(info.childLink);
      if (!parentGroup || !childGroup) continue;

      const start = parentGroup.position.clone();
      const end = childGroup.position.clone();
      const mid = start.clone().add(end).multiplyScalar(0.5);
      const length = start.distanceTo(end);

      if (length < 0.001) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;

      mesh.position.copy(mid);
      mesh.scale.set(1, length, 1);

      const dir = end.clone().sub(start).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
      mesh.quaternion.copy(quat);
    }

    // Update joint sphere positions
    for (const joint of this.joints) {
      const info = this.jointInfoList.find(j => j.name === joint.name);
      if (!info?.childLink) continue;

      const childGroup = this.linkGroups.get(info.childLink);
      const sphere = this.scene.getObjectByName('sphere_' + joint.name);
      if (childGroup && sphere) {
        sphere.position.copy(childGroup.position);
      }
    }
  }

  private initScene(): void {
    const container = this.sceneContainer.nativeElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(1.5, -1.5, 1.2);
    this.camera.lookAt(0, 0, 0.4);

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
    this.controls.target.set(0, 0, 0.4);
    this.controls.mouseButtons = {
      LEFT: null as any,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.zoomToCursor = true;

    const grid = new THREE.GridHelper(4, 20, 0x444466, 0x333355);
    grid.rotation.x = Math.PI / 2;
    this.scene.add(grid);

    const worldAxes = this.createAxes(0.3);
    const worldLabel = this.createLabel('world');
    worldAxes.add(worldLabel);
    this.scene.add(worldAxes);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(3, -3, 5);
    this.scene.add(dirLight);
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-2, 2, 3);
    this.scene.add(dirLight2);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.onResize();
  }

  private animate(): void {
    this.animFrameId = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
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

  private createAxes(length: number): THREE.Group {
    const group = new THREE.Group();
    const radius = length * 0.08;
    const axes: [THREE.Vector3, number][] = [
      [new THREE.Vector3(1, 0, 0), 0xff4444],
      [new THREE.Vector3(0, 1, 0), 0x44cc44],
      [new THREE.Vector3(0, 0, 1), 0x4488ff],
    ];
    for (const [dir, color] of axes) {
      const geo = new THREE.CylinderGeometry(radius, radius, length, 8);
      geo.translate(0, length / 2, 0);
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
    div.style.fontSize = '11px';
    div.style.padding = '2px 6px';
    div.style.background = 'rgba(0, 0, 0, 0.6)';
    div.style.borderRadius = '3px';
    div.style.whiteSpace = 'nowrap';
    const label = new CSS2DObject(div);
    label.position.set(0, 0.08, 0);
    return label;
  }

  radToDeg(rad: number): number {
    return rad * 180 / Math.PI;
  }
}
