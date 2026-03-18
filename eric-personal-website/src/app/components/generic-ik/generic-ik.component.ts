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
  axis: any;  // DoubleVector (3 elements: x, y, z)
  originXyz: any;  // DoubleVector (3 elements: x, y, z)
  originRpy: any;  // DoubleVector (3 elements: roll, pitch, yaw)
}

interface ManipulabilityResult {
  wPos: number;
  wOri: number;
  posAxes: any;    // DoubleVector (9 elements)
  posValues: any;  // DoubleVector (3 elements)
  oriAxes: any;    // DoubleVector (9 elements)
  oriValues: any;  // DoubleVector (3 elements)
}

interface EllipsoidVisualization {
  posEllipsoid: THREE.Mesh | null;
  oriEllipsoid: THREE.Mesh | null;
  posAxesGroup: THREE.Group | null;
  oriAxesGroup: THREE.Group | null;
}

interface KinematicsModule {
  loadUrdfFromString(urdfContent: string): any;
  fkFlat(tree: any, linkName: string): any;
  getJointLimits(tree: any, jointName: string): any;
  getLinkNames(tree: any): any;
  getJointInfo(tree: any): any;
  getPositionManipulability(
    tree: any,
    tipName: string,
    baseName: string,
    jointNames: any
  ): number;
  getManipulability(
    tree: any,
    tipName: string,
    baseName: string,
    jointNames: any
  ): ManipulabilityResult;
  StringVector: any;
}

interface MonteCarloPoint {
  position: THREE.Vector3;
  manipulability: number;
  conditionNumber: number;
  jointConfig: number[];
}

interface PointCloudVisualization {
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  data: MonteCarloPoint[];
  visible: boolean;
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

  wasmModule: KinematicsModule | null = null;
  private kinematicTree: any = null;
  private linkGroups = new Map<string, THREE.Group>();
  private linkMeshes = new Map<string, THREE.Mesh>();
  private jointInfoList: JointInfo[] = [];

  pointCloud: PointCloudVisualization | null = null;
  manipulabilityRange = { min: Infinity, max: -Infinity };
  conditionNumberRange = { min: Infinity, max: -Infinity };

  manipulabilityEllipsoid: EllipsoidVisualization | null = null;

  // Clipping planes
  private plane1: THREE.Mesh | null = null;
  private plane2: THREE.Mesh | null = null;
  private arrow1: THREE.ArrowHelper | null = null;
  private arrow2: THREE.ArrowHelper | null = null;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private dragArrow: THREE.ArrowHelper | null = null;
  private dragStartZ = 0;
  private dragStartMouseY = 0;

  // UI controls
  showPointCloud = false;
  pointCloudCount = 200;
  isGeneratingPointCloud = false;
  pointCloudProgress = 0;
  showClippingPlanes = false;
  enablePlaneFiltering = false;
  selectedUrdf = 'ur5';
  availableUrdfs = [
    { name: 'ur5', label: 'UR5 (6DOF)' },
    { name: 'simple_3dof', label: 'Simple 3DOF' }
  ];
  manipulabilityMetric: 'volume' | 'condition' = 'volume';
  private cancelGeneration = false;

  // Manipulability ellipsoid controls
  showManipulabilityEllipsoid = true;
  showPositionEllipsoid = true;
  showOrientationEllipsoid = false;
  showEllipsoidAxes = true;
  ellipsoidOpacity = 0.3;

  // Robot and frame visibility controls
  showRobot = true;
  showFrames = true;

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

    // Clean up point cloud
    if (this.pointCloud) {
      this.scene.remove(this.pointCloud.points);
      this.pointCloud.geometry.dispose();
      this.pointCloud.material.dispose();
    }

    // Clean up clipping planes
    if (this.plane1) {
      this.scene.remove(this.plane1);
      (this.plane1.material as THREE.Material).dispose();
      this.plane1.geometry.dispose();
    }
    if (this.plane2) {
      this.scene.remove(this.plane2);
      (this.plane2.material as THREE.Material).dispose();
      this.plane2.geometry.dispose();
    }
    if (this.arrow1) {
      this.scene.remove(this.arrow1);
      this.arrow1.dispose();
    }
    if (this.arrow2) {
      this.scene.remove(this.arrow2);
      this.arrow2.dispose();
    }

    // Clean up ellipsoid
    this.cleanupEllipsoidVisualization();
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

      await this.loadUrdf(this.selectedUrdf);
      this.loading = false;
    } catch (e: any) {
      this.errorMessage = e.message || String(e);
      this.loading = false;
    }
  }

  private async loadUrdf(urdfName: string): Promise<void> {
    if (!this.wasmModule) return;

    // Clear existing robot
    this.clearRobot();

    const urdfResponse = await fetch(`/assets/urdf/${urdfName}.urdf`);
    const urdfContent = await urdfResponse.text();
    this.kinematicTree = this.wasmModule.loadUrdfFromString(urdfContent);

    this.extractJointInfo();
    this.buildRobot();

    // Clear point cloud when switching robots
    if (this.pointCloud) {
      this.scene.remove(this.pointCloud.points);
      this.pointCloud.geometry.dispose();
      this.pointCloud.material.dispose();
      this.pointCloud = null;
      this.manipulabilityRange = { min: Infinity, max: -Infinity };
    }
  }

  private clearRobot(): void {
    // Remove all link groups and meshes
    this.linkGroups.forEach(group => {
      this.scene.remove(group);
    });
    this.linkGroups.clear();

    this.linkMeshes.forEach(mesh => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.scene.remove(mesh);
    });
    this.linkMeshes.clear();

    // Remove joint cylinders
    for (const joint of this.joints) {
      const cylinder = this.scene.getObjectByName('joint_cylinder_' + joint.name);
      if (cylinder) {
        this.scene.remove(cylinder);
        (cylinder as THREE.Mesh).geometry.dispose();
        ((cylinder as THREE.Mesh).material as THREE.Material).dispose();
      }
    }

    this.joints = [];
    this.jointInfoList = [];

    // Clean up ellipsoid
    this.cleanupEllipsoidVisualization();
  }

  async onUrdfChange(): Promise<void> {
    this.loading = true;
    try {
      await this.loadUrdf(this.selectedUrdf);
    } catch (e: any) {
      this.errorMessage = e.message || String(e);
    }
    this.loading = false;
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
    const linkColor = 0x888888;  // Gray for all links
    for (let i = 0; i < this.jointInfoList.length; i++) {
      const info = this.jointInfoList[i];
      if (!info.parentLink || !info.childLink) continue;

      const mat = new THREE.MeshStandardMaterial({ color: linkColor });
      const geo = new THREE.CylinderGeometry(0.04, 0.04, 1, 12);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;  // Hide initially, will be shown in updateRobotVisualization
      this.scene.add(mesh);
      this.linkMeshes.set(info.name, mesh);
    }

    // Joint cylinders at each active joint (oriented along joint axis)
    const jointColor = 0xffb380;  // Pastel orange for all joints
    const linkRadius = 0.04;
    const jointRadius = linkRadius * 1.2;  // 20% larger than links
    const jointHeight = jointRadius * 2;  // Height = diameter

    for (const joint of this.joints) {
      const info = this.jointInfoList.find(j => j.name === joint.name);
      if (!info || !info.axis) continue;

      // Extract axis from WASM vector
      const axisX = info.axis.get(0);
      const axisY = info.axis.get(1);
      const axisZ = info.axis.get(2);
      const axisVec = new THREE.Vector3(axisX, axisY, axisZ).normalize();

      // Create cylinder (height along Y axis by default, 20% larger radius than links)
      const cylinder = new THREE.Mesh(
        new THREE.CylinderGeometry(jointRadius, jointRadius, jointHeight, 16),
        new THREE.MeshStandardMaterial({ color: jointColor })
      );

      // Orient cylinder along joint axis
      const yAxis = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(yAxis, axisVec);
      cylinder.quaternion.copy(quaternion);

      cylinder.name = 'joint_cylinder_' + joint.name;
      this.scene.add(cylinder);
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
      mesh.visible = this.showRobot;

      mesh.position.copy(mid);
      mesh.scale.set(1, length, 1);

      const dir = end.clone().sub(start).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
      mesh.quaternion.copy(quat);
    }

    // Update joint cylinder positions and orientations
    for (const joint of this.joints) {
      const info = this.jointInfoList.find(j => j.name === joint.name);
      if (!info?.childLink || !info?.axis) continue;

      const childGroup = this.linkGroups.get(info.childLink);
      const cylinder = this.scene.getObjectByName('joint_cylinder_' + joint.name);

      if (childGroup && cylinder) {
        // Position at child link
        cylinder.position.copy(childGroup.position);

        // Get the joint frame transform using FK
        try {
          const jointFlatVec = this.wasmModule!.fkFlat(this.kinematicTree, joint.name);
          const jointElements: number[] = [];
          for (let i = 0; i < 16; i++) jointElements.push(jointFlatVec.get(i));
          jointFlatVec.delete();

          const jointMat4 = new THREE.Matrix4().fromArray(jointElements);
          const jointQuat = new THREE.Quaternion().setFromRotationMatrix(jointMat4);

          // Extract joint axis from WASM vector
          const axisX = info.axis.get(0);
          const axisY = info.axis.get(1);
          const axisZ = info.axis.get(2);
          const localAxis = new THREE.Vector3(axisX, axisY, axisZ).normalize();

          // Transform local axis by joint frame rotation to get world-space direction
          const worldAxis = localAxis.clone().applyQuaternion(jointQuat);

          // Orient cylinder along the transformed axis
          const yAxis = new THREE.Vector3(0, 1, 0);
          const quaternion = new THREE.Quaternion().setFromUnitVectors(yAxis, worldAxis);
          cylinder.quaternion.copy(quaternion);

          cylinder.visible = this.showRobot;
        } catch (error) {
          // If FK fails for this joint, skip it
          console.warn(`Could not get FK for joint ${joint.name}:`, error);
        }
      }
    }

    // Update ellipsoid if visible
    if (this.showManipulabilityEllipsoid) {
      this.createManipulabilityEllipsoidVisualization();
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
    worldAxes.name = 'world_axes';
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

    this.initClippingPlanes();
  }

  private initClippingPlanes(): void {
    // Create two semi-transparent planes
    const planeGeometry = new THREE.PlaneGeometry(2, 2);
    const planeMaterial1 = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide
    });
    const planeMaterial2 = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide
    });

    this.plane1 = new THREE.Mesh(planeGeometry, planeMaterial1);
    this.plane1.position.set(0, 0, 0.2);
    this.plane1.visible = false;
    this.scene.add(this.plane1);

    this.plane2 = new THREE.Mesh(planeGeometry, planeMaterial2);
    this.plane2.position.set(0, 0, 0.6);
    this.plane2.visible = false;
    this.scene.add(this.plane2);

    // Create arrows for dragging (pointing up along Z-axis)
    const direction = new THREE.Vector3(0, 0, 1);
    const origin1 = new THREE.Vector3(0, 0, 0);
    const origin2 = new THREE.Vector3(0, 0, 0);
    const length = 0.4;
    const headLength = 0.15;
    const headWidth = 0.1;

    this.arrow1 = new THREE.ArrowHelper(direction, origin1, length, 0x00ff00, headLength, headWidth);
    this.arrow1.visible = false;
    this.arrow1.position.copy(this.plane1.position);
    this.scene.add(this.arrow1);

    this.arrow2 = new THREE.ArrowHelper(direction, origin2, length, 0xff0000, headLength, headWidth);
    this.arrow2.visible = false;
    this.arrow2.position.copy(this.plane2.position);
    this.scene.add(this.arrow2);

    // Add mouse event listeners for dragging arrows
    const canvas = this.renderer.domElement;

    canvas.addEventListener('mousedown', (event) => this.onArrowMouseDown(event), false);
    canvas.addEventListener('mousemove', (event) => this.onArrowMouseMove(event), false);
    canvas.addEventListener('mouseup', () => this.onArrowMouseUp(), false);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault(), false);
  }

  private onArrowMouseDown(event: MouseEvent): void {
    // Only respond to left-click
    if (event.button !== 0) return;
    if (!this.showClippingPlanes) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check intersections with arrow cones only (the head)
    const arrowObjects: THREE.Object3D[] = [];
    if (this.arrow1) {
      // Only add the cone (first child is the line, second is the cone)
      const cone = this.arrow1.children.find(child => child.type === 'Mesh');
      if (cone) arrowObjects.push(cone);
    }
    if (this.arrow2) {
      const cone = this.arrow2.children.find(child => child.type === 'Mesh');
      if (cone) arrowObjects.push(cone);
    }

    const intersects = this.raycaster.intersectObjects(arrowObjects, false);

    if (intersects.length > 0) {
      // Find which arrow was clicked
      const clickedObject = intersects[0].object;
      if (this.arrow1?.children.includes(clickedObject)) {
        this.dragArrow = this.arrow1;
      } else if (this.arrow2?.children.includes(clickedObject)) {
        this.dragArrow = this.arrow2;
      }

      if (this.dragArrow) {
        this.dragStartZ = this.dragArrow.position.z;
        this.dragStartMouseY = this.mouse.y;
        this.controls.enabled = false;
        event.preventDefault();
      }
    }
  }

  private onArrowMouseMove(event: MouseEvent): void {
    if (!this.dragArrow) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Map mouse Y movement to Z-axis movement
    const deltaMouseY = this.mouse.y - this.dragStartMouseY;
    const newZ = this.dragStartZ + deltaMouseY * 2; // Scale factor for sensitivity

    // Update arrow and corresponding plane position
    this.dragArrow.position.z = newZ;

    if (this.dragArrow === this.arrow1 && this.plane1) {
      this.plane1.position.z = newZ;
    } else if (this.dragArrow === this.arrow2 && this.plane2) {
      this.plane2.position.z = newZ;
    }

    if (this.enablePlaneFiltering) {
      this.updatePointCloudFiltering();
    }
  }

  private onArrowMouseUp(): void {
    if (this.dragArrow) {
      this.dragArrow = null;
      this.controls.enabled = true;
    }
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

  private extractAxesFromVector(axesVec: any): THREE.Vector3[] {
    // Column-major: [col0_x, col0_y, col0_z, col1_x, col1_y, col1_z, col2_x, col2_y, col2_z]
    const axes: THREE.Vector3[] = [];
    for (let col = 0; col < 3; col++) {
      axes.push(new THREE.Vector3(
        axesVec.get(col * 3 + 0),
        axesVec.get(col * 3 + 1),
        axesVec.get(col * 3 + 2)
      ));
    }
    return axes;
  }

  private extractValuesFromVector(valuesVec: any): number[] {
    const values: number[] = [];
    for (let i = 0; i < 3; i++) values.push(valuesVec.get(i));
    return values;
  }

  private createEllipsoidMesh(
    position: THREE.Vector3,
    axes: THREE.Vector3[],
    values: number[],
    color: number,
    opacity: number
  ): THREE.Mesh {
    // More segments for smoother wireframe
    const geometry = new THREE.SphereGeometry(1, 48, 36);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      wireframe: true,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);

    // Build rotation matrix from principal axes (columns)
    const rotationMatrix = new THREE.Matrix4();
    rotationMatrix.set(
      axes[0].x, axes[1].x, axes[2].x, 0,
      axes[0].y, axes[1].y, axes[2].y, 0,
      axes[0].z, axes[1].z, axes[2].z, 0,
      0, 0, 0, 1
    );

    // Apply scale then rotation
    const scaleMatrix = new THREE.Matrix4().makeScale(values[0], values[1], values[2]);
    const transform = new THREE.Matrix4().multiplyMatrices(rotationMatrix, scaleMatrix);

    mesh.matrix.copy(transform);
    mesh.matrix.setPosition(position);
    mesh.matrixAutoUpdate = false;

    return mesh;
  }

  private createEllipsoidAxes(
    position: THREE.Vector3,
    axes: THREE.Vector3[],
    values: number[],
    baseColor: number
  ): THREE.Group {
    const group = new THREE.Group();

    for (let i = 0; i < 3; i++) {
      const direction = axes[i].clone().normalize();
      const length = values[i];

      // Brightest for largest axis
      const brightness = 0.5 + (0.5 * (i === 0 ? 1.0 : i === 1 ? 0.7 : 0.4));
      const axisColor = new THREE.Color(baseColor).multiplyScalar(brightness);

      const arrow = new THREE.ArrowHelper(
        direction,
        position,
        length,
        axisColor.getHex(),
        length * 0.15,
        length * 0.1
      );

      group.add(arrow);
    }

    return group;
  }

  private createPointCloudVisualization(mcPoints: MonteCarloPoint[]): void {
    // Clean up existing
    if (this.pointCloud) {
      this.scene.remove(this.pointCloud.points);
      this.pointCloud.geometry.dispose();
      this.pointCloud.material.dispose();
    }

    const positions: number[] = [];
    const colors: number[] = [];

    for (const mcPoint of mcPoints) {
      positions.push(mcPoint.position.x, mcPoint.position.y, mcPoint.position.z);

      // Color mapping based on selected metric
      let value: number, minVal: number, maxVal: number;
      if (this.manipulabilityMetric === 'volume') {
        value = mcPoint.manipulability;
        minVal = this.manipulabilityRange.min;
        maxVal = this.manipulabilityRange.max;
      } else {
        // Condition number: lower is better (use log scale)
        value = isFinite(mcPoint.conditionNumber) ? mcPoint.conditionNumber : this.conditionNumberRange.max;
        minVal = this.conditionNumberRange.min;
        maxVal = this.conditionNumberRange.max;
      }

      // Color mapping: Blue (good) → Red (bad/singularities)
      const useLogScale = this.manipulabilityMetric === 'condition';
      const color = this.manipulabilityToColor(value, minVal, maxVal, useLogScale);
      colors.push(color.r, color.g, color.b);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.01875,  // 50% of previous size
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,  // Less see-through
      depthWrite: false
    });

    const points = new THREE.Points(geometry, material);
    points.visible = true;  // Always show after generation
    this.showPointCloud = true;  // Update UI state
    this.scene.add(points);

    this.pointCloud = { points, geometry, material, data: mcPoints, visible: this.showPointCloud };

    // Apply filtering if enabled
    if (this.enablePlaneFiltering) {
      this.updatePointCloudFiltering();
    }
  }

  private updatePointCloudFiltering(): void {
    if (!this.pointCloud || !this.enablePlaneFiltering || !this.plane1 || !this.plane2) return;

    // Get plane normals and positions
    const plane1Normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.plane1.quaternion);
    const plane1Point = this.plane1.position.clone();
    const plane2Normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.plane2.quaternion);
    const plane2Point = this.plane2.position.clone();

    // OPTIMIZATION 3: Reuse temp vector (avoid allocations in hot loop)
    const tempVec = new THREE.Vector3();

    // Filter points: only show points between the two planes
    const newPositions: number[] = [];
    const newColors: number[] = [];

    for (let i = 0; i < this.pointCloud.data.length; i++) {
      const point = this.pointCloud.data[i].position;

      // Calculate distances without cloning (reuse tempVec)
      tempVec.copy(point).sub(plane1Point);
      const dist1 = plane1Normal.dot(tempVec);

      tempVec.copy(point).sub(plane2Point);
      const dist2 = plane2Normal.dot(tempVec);

      // Point is between planes if it's on opposite sides of both planes
      const isBetween = (dist1 >= 0 && dist2 <= 0) || (dist1 <= 0 && dist2 >= 0);

      if (isBetween) {
        newPositions.push(point.x, point.y, point.z);

        // Color based on selected metric
        let value: number, minVal: number, maxVal: number;
        if (this.manipulabilityMetric === 'volume') {
          value = this.pointCloud.data[i].manipulability;
          minVal = this.manipulabilityRange.min;
          maxVal = this.manipulabilityRange.max;
        } else {
          value = isFinite(this.pointCloud.data[i].conditionNumber)
            ? this.pointCloud.data[i].conditionNumber
            : this.conditionNumberRange.max;
          minVal = this.conditionNumberRange.min;
          maxVal = this.conditionNumberRange.max;
        }

        const useLogScale = this.manipulabilityMetric === 'condition';
        const color = this.manipulabilityToColor(value, minVal, maxVal, useLogScale);
        newColors.push(color.r, color.g, color.b);
      }
    }

    // Update geometry
    this.pointCloud.geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    this.pointCloud.geometry.setAttribute('color', new THREE.Float32BufferAttribute(newColors, 3));
    this.pointCloud.geometry.attributes['position'].needsUpdate = true;
    this.pointCloud.geometry.attributes['color'].needsUpdate = true;
  }

  private createManipulabilityEllipsoidVisualization(): void {
    if (!this.wasmModule || !this.kinematicTree) return;

    // Clean up existing
    if (this.manipulabilityEllipsoid) {
      this.cleanupEllipsoidVisualization();
    }

    try {
      // Get manipulability data
      const jointNamesVec = new this.wasmModule.StringVector();
      for (const joint of this.joints) {
        jointNamesVec.push_back(joint.name);
      }

      // Check if getManipulability function exists
      if (!this.wasmModule.getManipulability) {
        console.warn('getManipulability function not available in WASM module');
        jointNamesVec.delete();
        return;
      }

      const manip = this.wasmModule.getManipulability(
        this.kinematicTree,
        'ee_link',
        'base_link',
        jointNamesVec
      );
      jointNamesVec.delete();

      // Validate manipulability result
      if (!manip || !manip.posAxes || !manip.posValues || !manip.oriAxes || !manip.oriValues) {
        console.warn('Invalid manipulability result');
        return;
      }

      // Get end-effector position
      const flatVec = this.wasmModule.fkFlat(this.kinematicTree, 'ee_link');
      const elements: number[] = [];
      for (let i = 0; i < 16; i++) elements.push(flatVec.get(i));
      flatVec.delete();

      const mat4 = new THREE.Matrix4().fromArray(elements);
      const eePosition = new THREE.Vector3().setFromMatrixPosition(mat4);

      // Extract ellipsoid data
      const posAxes = this.extractAxesFromVector(manip.posAxes);
      const posValues = this.extractValuesFromVector(manip.posValues);
      const oriAxes = this.extractAxesFromVector(manip.oriAxes);
      const oriValues = this.extractValuesFromVector(manip.oriValues);

      // Create position ellipsoid (blue)
      const posEllipsoid = this.createEllipsoidMesh(
        eePosition, posAxes, posValues, 0x4488ff, this.ellipsoidOpacity
      );
      posEllipsoid.visible = this.showPositionEllipsoid && this.showManipulabilityEllipsoid;
      this.scene.add(posEllipsoid);

      // Create orientation ellipsoid (green, scaled by 0.1 for visibility)
      const scaledOriValues = oriValues.map(v => v * 0.1);
      const oriEllipsoid = this.createEllipsoidMesh(
        eePosition, oriAxes, scaledOriValues, 0x44ff44, this.ellipsoidOpacity
      );
      oriEllipsoid.visible = this.showOrientationEllipsoid && this.showManipulabilityEllipsoid;
      this.scene.add(oriEllipsoid);

      // Create axis arrows
      const posAxesGroup = this.createEllipsoidAxes(eePosition, posAxes, posValues, 0x0000ff);
      posAxesGroup.visible = this.showEllipsoidAxes && this.showPositionEllipsoid && this.showManipulabilityEllipsoid;
      this.scene.add(posAxesGroup);

      const oriAxesGroup = this.createEllipsoidAxes(eePosition, oriAxes, scaledOriValues, 0x00ff00);
      oriAxesGroup.visible = this.showEllipsoidAxes && this.showOrientationEllipsoid && this.showManipulabilityEllipsoid;
      this.scene.add(oriAxesGroup);

      this.manipulabilityEllipsoid = {
        posEllipsoid,
        oriEllipsoid,
        posAxesGroup,
        oriAxesGroup
      };

      // Clean up WASM vectors
      manip.posAxes.delete();
      manip.posValues.delete();
      manip.oriAxes.delete();
      manip.oriValues.delete();

    } catch (error) {
      console.error('Error creating manipulability ellipsoid:', error);
      // Silently fail - don't show ellipsoid if there's an issue
      this.cleanupEllipsoidVisualization();
    }
  }

  private cleanupEllipsoidVisualization(): void {
    if (!this.manipulabilityEllipsoid) return;

    if (this.manipulabilityEllipsoid.posEllipsoid) {
      this.scene.remove(this.manipulabilityEllipsoid.posEllipsoid);
      this.manipulabilityEllipsoid.posEllipsoid.geometry.dispose();
      (this.manipulabilityEllipsoid.posEllipsoid.material as THREE.Material).dispose();
    }

    if (this.manipulabilityEllipsoid.oriEllipsoid) {
      this.scene.remove(this.manipulabilityEllipsoid.oriEllipsoid);
      this.manipulabilityEllipsoid.oriEllipsoid.geometry.dispose();
      (this.manipulabilityEllipsoid.oriEllipsoid.material as THREE.Material).dispose();
    }

    if (this.manipulabilityEllipsoid.posAxesGroup) {
      this.scene.remove(this.manipulabilityEllipsoid.posAxesGroup);
    }

    if (this.manipulabilityEllipsoid.oriAxesGroup) {
      this.scene.remove(this.manipulabilityEllipsoid.oriAxesGroup);
    }

    this.manipulabilityEllipsoid = null;
  }

  private manipulabilityToColor(value: number, min: number, max: number, useLogScale = false): THREE.Color {
    let normalized: number;

    if (useLogScale) {
      // Logarithmic scale for condition number (spans orders of magnitude)
      const logValue = Math.log10(value);
      const logMin = Math.log10(min);
      const logMax = Math.log10(max);
      normalized = (logMax - logMin) > 0 ? (logValue - logMin) / (logMax - logMin) : 0.5;
      // Invert: low condition number (good) → blue, high (bad) → red
      normalized = 1 - normalized;
    } else {
      // Linear scale for volume
      normalized = (max - min) > 0 ? (value - min) / (max - min) : 0.5;
    }

    // Clamp to [0, 1]
    normalized = Math.max(0, Math.min(1, normalized));

    // Map: 0 (bad) → red (0°), 1 (good) → blue (240°)
    // This creates a smooth transition: red → orange → yellow → green → cyan → blue
    const hue = normalized * 240;

    return new THREE.Color().setHSL(hue / 360, 1.0, 0.5);
  }

  onPointCloudVisibilityChange(): void {
    if (this.pointCloud) {
      this.pointCloud.points.visible = this.showPointCloud;
    }
  }

  onClippingPlanesVisibilityChange(): void {
    if (this.plane1 && this.plane2) {
      this.plane1.visible = this.showClippingPlanes;
      this.plane2.visible = this.showClippingPlanes;
    }
    if (this.arrow1 && this.arrow2) {
      this.arrow1.visible = this.showClippingPlanes;
      this.arrow2.visible = this.showClippingPlanes;
    }
  }

  onPlaneFilteringChange(): void {
    if (this.enablePlaneFiltering) {
      this.updatePointCloudFiltering();
    } else {
      // Restore all points
      if (this.pointCloud) {
        const positions: number[] = [];
        const colors: number[] = [];

        for (const mcPoint of this.pointCloud.data) {
          positions.push(mcPoint.position.x, mcPoint.position.y, mcPoint.position.z);

          // Color based on selected metric
          let value: number, minVal: number, maxVal: number;
          if (this.manipulabilityMetric === 'volume') {
            value = mcPoint.manipulability;
            minVal = this.manipulabilityRange.min;
            maxVal = this.manipulabilityRange.max;
          } else {
            value = isFinite(mcPoint.conditionNumber) ? mcPoint.conditionNumber : this.conditionNumberRange.max;
            minVal = this.conditionNumberRange.min;
            maxVal = this.conditionNumberRange.max;
          }

          const useLogScale = this.manipulabilityMetric === 'condition';
          const color = this.manipulabilityToColor(value, minVal, maxVal, useLogScale);
          colors.push(color.r, color.g, color.b);
        }

        this.pointCloud.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        this.pointCloud.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        this.pointCloud.geometry.attributes['position'].needsUpdate = true;
        this.pointCloud.geometry.attributes['color'].needsUpdate = true;
      }
    }
  }

  onManipulabilityEllipsoidVisibilityChange(): void {
    if (this.showManipulabilityEllipsoid) {
      this.createManipulabilityEllipsoidVisualization();
    } else {
      this.cleanupEllipsoidVisualization();
    }
  }

  onPositionEllipsoidVisibilityChange(): void {
    if (this.manipulabilityEllipsoid?.posEllipsoid) {
      this.manipulabilityEllipsoid.posEllipsoid.visible =
        this.showPositionEllipsoid && this.showManipulabilityEllipsoid;
    }
    if (this.manipulabilityEllipsoid?.posAxesGroup) {
      this.manipulabilityEllipsoid.posAxesGroup.visible =
        this.showEllipsoidAxes && this.showPositionEllipsoid && this.showManipulabilityEllipsoid;
    }
  }

  onOrientationEllipsoidVisibilityChange(): void {
    if (this.manipulabilityEllipsoid?.oriEllipsoid) {
      this.manipulabilityEllipsoid.oriEllipsoid.visible =
        this.showOrientationEllipsoid && this.showManipulabilityEllipsoid;
    }
    if (this.manipulabilityEllipsoid?.oriAxesGroup) {
      this.manipulabilityEllipsoid.oriAxesGroup.visible =
        this.showEllipsoidAxes && this.showOrientationEllipsoid && this.showManipulabilityEllipsoid;
    }
  }

  onEllipsoidAxesVisibilityChange(): void {
    if (this.manipulabilityEllipsoid?.posAxesGroup) {
      this.manipulabilityEllipsoid.posAxesGroup.visible =
        this.showEllipsoidAxes && this.showPositionEllipsoid && this.showManipulabilityEllipsoid;
    }
    if (this.manipulabilityEllipsoid?.oriAxesGroup) {
      this.manipulabilityEllipsoid.oriAxesGroup.visible =
        this.showEllipsoidAxes && this.showOrientationEllipsoid && this.showManipulabilityEllipsoid;
    }
  }

  onEllipsoidOpacityChange(): void {
    if (this.manipulabilityEllipsoid?.posEllipsoid) {
      (this.manipulabilityEllipsoid.posEllipsoid.material as THREE.MeshBasicMaterial).opacity =
        this.ellipsoidOpacity;
    }
    if (this.manipulabilityEllipsoid?.oriEllipsoid) {
      (this.manipulabilityEllipsoid.oriEllipsoid.material as THREE.MeshBasicMaterial).opacity =
        this.ellipsoidOpacity;
    }
  }

  onShowRobotChange(): void {
    // Toggle link meshes (cylinders)
    this.linkMeshes.forEach(mesh => {
      mesh.visible = this.showRobot;
    });

    // Toggle joint cylinders
    for (const joint of this.joints) {
      const cylinder = this.scene.getObjectByName('joint_cylinder_' + joint.name);
      if (cylinder) {
        cylinder.visible = this.showRobot;
      }
    }
  }

  onShowFramesChange(): void {
    // Toggle axes in link groups
    this.linkGroups.forEach((group) => {
      group.traverse((obj) => {
        if (obj.type === 'Group' && obj !== group) {
          // This is likely an axes group
          obj.visible = this.showFrames;
        }
        if (obj instanceof THREE.ArrowHelper) {
          obj.visible = this.showFrames;
        }
        if (obj instanceof CSS2DObject) {
          obj.visible = this.showFrames;
        }
      });
    });

    // Toggle world axes if it exists
    const worldAxes = this.scene.getObjectByName('world_axes');
    if (worldAxes) {
      worldAxes.visible = this.showFrames;
    }
  }

  onManipulabilityMetricChange(): void {
    // Re-color the existing point cloud with the new metric
    if (this.pointCloud) {
      this.createPointCloudVisualization(this.pointCloud.data);
    }
  }

  async regeneratePointCloud(): Promise<void> {
    if (!this.wasmModule || !this.kinematicTree) return;
    this.manipulabilityRange = { min: Infinity, max: -Infinity };
    this.conditionNumberRange = { min: Infinity, max: -Infinity };
    await this.generateMonteCarloPointCloud();
  }

  private async generateMonteCarloPointCloud(): Promise<void> {
    if (!this.wasmModule || !this.kinematicTree) return;

    this.isGeneratingPointCloud = true;
    this.pointCloudProgress = 0;
    this.cancelGeneration = false;
    const points: MonteCarloPoint[] = [];

    // OPTIMIZATION 2: Adaptive batch size (target ~20-30 batches, more responsive)
    const batchSize = Math.max(20, Math.min(200, Math.floor(this.pointCloudCount / 25)));

    // Get joint limits for random sampling
    const jointLimits = this.joints.map(j => ({
      name: j.name,
      lower: j.lower,
      upper: j.upper
    }));

    // Create StringVector for WASM calls
    const jointNamesVec = new this.wasmModule.StringVector();
    for (const joint of this.joints) {
      jointNamesVec.push_back(joint.name);
    }

    // OPTIMIZATION 1: Get plane bounds if filtering is enabled (rejection sampling)
    let planeBounds: { min: number, max: number } | null = null;
    if (this.enablePlaneFiltering && this.plane1 && this.plane2) {
      const plane1Z = this.plane1.position.z;
      const plane2Z = this.plane2.position.z;
      planeBounds = {
        min: Math.min(plane1Z, plane2Z),
        max: Math.max(plane1Z, plane2Z)
      };
    }

    // Use rejection sampling if plane filtering is enabled
    let successfulPoints = 0;
    let attempts = 0;
    const maxAttempts = this.pointCloudCount * 10; // Safety limit

    while (successfulPoints < this.pointCloudCount && attempts < maxAttempts && !this.cancelGeneration) {
      // Random joint configuration
      const jointConfig = jointLimits.map(limit =>
        limit.lower + Math.random() * (limit.upper - limit.lower)
      );

      // Update kinematic tree
      for (let k = 0; k < this.joints.length; k++) {
        this.kinematicTree.updateTheta(this.joints[k].name, jointConfig[k]);
      }

      // Get end-effector position via FK
      const flatVec = this.wasmModule.fkFlat(this.kinematicTree, 'ee_link');
      const elements: number[] = [];
      for (let k = 0; k < 16; k++) elements.push(flatVec.get(k));
      flatVec.delete();

      const mat4 = new THREE.Matrix4().fromArray(elements);
      const position = new THREE.Vector3().setFromMatrixPosition(mat4);

      // OPTIMIZATION 1: Check if point is within plane bounds BEFORE expensive manipulability calculation
      if (planeBounds) {
        const posZ = position.z;
        if (posZ < planeBounds.min || posZ > planeBounds.max) {
          attempts++;
          continue; // Skip this point - outside bounds
        }
      }

      // Only compute manipulability for points that passed the filter
      const manip = this.wasmModule.getManipulability(
        this.kinematicTree,
        'ee_link',
        'base_link',
        jointNamesVec
      );

      const manipulability = manip.wPos;

      // Calculate condition number from singular values
      const posValues = [];
      for (let k = 0; k < 3; k++) {
        posValues.push(manip.posValues.get(k));
      }
      const maxValue = Math.max(...posValues);
      const minValue = Math.min(...posValues);
      const conditionNumber = minValue > 0 ? maxValue / minValue : Infinity;

      // Clean up WASM vectors
      manip.posAxes.delete();
      manip.posValues.delete();
      manip.oriAxes.delete();
      manip.oriValues.delete();

      points.push({ position, manipulability, conditionNumber, jointConfig: [...jointConfig] });
      successfulPoints++;
      attempts++;

      // Track range for color mapping
      this.manipulabilityRange.min = Math.min(this.manipulabilityRange.min, manipulability);
      this.manipulabilityRange.max = Math.max(this.manipulabilityRange.max, manipulability);

      // Track condition number range (skip Infinity values)
      if (isFinite(conditionNumber)) {
        this.conditionNumberRange.min = Math.min(this.conditionNumberRange.min, conditionNumber);
        this.conditionNumberRange.max = Math.max(this.conditionNumberRange.max, conditionNumber);
      }

      // Batch progress updates (yield to UI every batch)
      if (successfulPoints % batchSize === 0) {
        this.pointCloudProgress = (successfulPoints / this.pointCloudCount) * 100;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    jointNamesVec.delete();

    // Restore original configuration
    for (const joint of this.joints) {
      this.kinematicTree.updateTheta(joint.name, joint.value);
    }
    this.updateRobotVisualization();

    // Only create visualization if we have points and weren't canceled
    if (points.length > 0 && !this.cancelGeneration) {
      // For condition numbers, use 95th percentile as max to avoid outlier skew
      const finiteConditionNumbers = points
        .map(p => p.conditionNumber)
        .filter(cn => isFinite(cn))
        .sort((a, b) => a - b);

      if (finiteConditionNumbers.length > 0) {
        const p95Index = Math.floor(finiteConditionNumbers.length * 0.95);
        this.conditionNumberRange.max = finiteConditionNumbers[p95Index];
      }

      console.log('Manipulability range:', this.manipulabilityRange);
      console.log('Condition number range:', this.conditionNumberRange);
      console.log('Condition number 95th percentile used as max');
      this.createPointCloudVisualization(points);
    }

    this.isGeneratingPointCloud = false;
    this.cancelGeneration = false;
  }

  cancelPointCloudGeneration(): void {
    this.cancelGeneration = true;
  }

  radToDeg(rad: number): number {
    return rad * 180 / Math.PI;
  }
}
