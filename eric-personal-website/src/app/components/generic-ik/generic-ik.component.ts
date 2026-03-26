import { Component, OnInit, AfterViewInit, OnDestroy, ElementRef, ViewChild, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

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
  getRootLink(tree: any): string;
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
  orientationManipulability: number;
  orientationConditionNumber: number;
  jointConfig: number[];
}

interface PointCloudVisualization {
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  data: MonteCarloPoint[];
  visible: boolean;
}

interface WorkspaceVolumeVisualization {
  mesh: THREE.Mesh;
  wireframe?: THREE.LineSegments;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshBasicMaterial;
  volume: number;
  voxelSize?: number;
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
  orientationManipulabilityRange = { min: Infinity, max: -Infinity };
  orientationConditionNumberRange = { min: Infinity, max: -Infinity };

  // Average manipulability measures
  averageManipulability: number | null = null;
  averageConditionNumber: number | null = null;
  averageOrientationManipulability: number | null = null;
  averageOrientationConditionNumber: number | null = null;

  manipulabilityEllipsoid: EllipsoidVisualization | null = null;
  workspaceVolume: WorkspaceVolumeVisualization | null = null;
  optimalVoxelSize: number | null = null;  // Cached optimal voxel size for adaptive method
  cachedVoxelMap: Map<string, THREE.Vector3> | null = null;  // Cached voxel grid (key -> center position)
  cachedConnectedVoxels: Set<string> | null = null;  // Cached connected voxel keys

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
  private selectedPointMarker: THREE.Mesh | null = null;
  private isDraggingPoints = false;
  private lastUpdateTime = 0;
  private readonly UPDATE_THROTTLE_MS = 50; // 20fps - slower to prevent WASM corruption
  private isUpdatingConfiguration = false;

  // UI controls
  showPointCloud = false;
  showWorkspaceVolume = false;
  volumeMethod: 'convex' | 'adaptive_voxel' = 'adaptive_voxel';
  pointCloudCount = 2000;
  isGeneratingPointCloud = false;
  pointCloudProgress = 0;
  showClippingPlanes = false;
  enablePlaneFiltering = false;
  selectedUrdf = 'ur5';
  availableUrdfs: Array<{ name: string; label: string }> = [];
  manipulabilityMetric: 'volume' | 'condition' | 'orientation_volume' | 'orientation_condition' = 'volume';
  private cancelGeneration = false;

  // Target link selection
  targetLink = 'ee_link';
  availableLinks: string[] = [];
  rootLink = 'base_link';

  // Current manipulability values
  currentManipulability: number | null = null;
  currentConditionNumber: number | null = null;
  currentOrientationManipulability: number | null = null;
  currentOrientationConditionNumber: number | null = null;

  // Current end-effector pose
  eePosition: THREE.Vector3 | null = null;
  eeQuaternion: THREE.Quaternion | null = null;

  // Manipulability ellipsoid controls
  showManipulabilityEllipsoid = true;
  showPositionEllipsoid = true;
  showOrientationEllipsoid = false;

  // Robot and frame visibility controls
  showRobot = true;
  showFrames = true;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    this.project = PROJECTS.find(p => p.slug === 'generic-ik');
  }

  async ngAfterViewInit(): Promise<void> {
    if (!this.isBrowser) return;
    this.initScene();
    this.animate();
    await this.loadUrdfManifest();
    this.loadWasm();
  }

  private async loadUrdfManifest(): Promise<void> {
    try {
      const response = await fetch('/assets/urdf/manifest.json');
      this.availableUrdfs = await response.json();

      // Ensure selected URDF is valid
      if (!this.availableUrdfs.find(u => u.name === this.selectedUrdf)) {
        this.selectedUrdf = this.availableUrdfs[0]?.name || 'ur5';
      }
    } catch (error) {
      console.error('Failed to load URDF manifest, using defaults:', error);
      // Fallback to hardcoded list
      this.availableUrdfs = [
        { name: 'ur5', label: 'UR5 (6DOF)' },
        { name: 'simple_3dof_a_f_f', label: 'Simple 3DOF (Active-Fixed-Fixed)' },
        { name: 'simple_3dof_f_a_f', label: 'Simple 3DOF (Fixed-Active-Fixed)' }
      ];
    }
  }

  ngOnDestroy(): void {
    if (!this.isBrowser) return;
    cancelAnimationFrame(this.animFrameId);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();

    // Clean up CSS2DObject labels before removing renderer
    this.linkGroups.forEach(group => {
      group.traverse((obj) => {
        if (obj instanceof CSS2DObject) {
          obj.removeFromParent();
          obj.element.remove();
        }
      });
      group.removeFromParent();
    });

    // Clean up world axes labels
    const worldAxes = this.scene?.getObjectByName('world_axes');
    if (worldAxes) {
      worldAxes.traverse((obj) => {
        if (obj instanceof CSS2DObject) {
          obj.removeFromParent();
          obj.element.remove();
        }
      });
    }

    this.labelRenderer?.domElement.remove();

    // Clean up point cloud
    if (this.pointCloud) {
      this.scene.remove(this.pointCloud.points);
      this.pointCloud.geometry.dispose();
      this.pointCloud.material.dispose();
    }

    // Clean up workspace volume
    if (this.workspaceVolume) {
      this.scene.remove(this.workspaceVolume.mesh);

      // Add cleanup for wireframe
      if (this.workspaceVolume.wireframe) {
        this.scene.remove(this.workspaceVolume.wireframe);
        (this.workspaceVolume.wireframe.geometry as THREE.EdgesGeometry).dispose();
        (this.workspaceVolume.wireframe.material as THREE.LineBasicMaterial).dispose();
      }

      this.workspaceVolume.geometry.dispose();
      this.workspaceVolume.material.dispose();
      this.workspaceVolume = null;
    }
    this.optimalVoxelSize = null;
    this.cachedVoxelMap = null;
    this.cachedConnectedVoxels = null;

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

    // Clean up selected point marker
    if (this.selectedPointMarker) {
      this.scene.remove(this.selectedPointMarker);
      this.selectedPointMarker.geometry.dispose();
      (this.selectedPointMarker.material as THREE.Material).dispose();
      this.selectedPointMarker = null;
    }
  }

  onJointChange(): void {
    if (!this.wasmModule || !this.kinematicTree) return;

    // Prevent conflicts with point configuration updates
    if (this.isUpdatingConfiguration) return;

    this.isUpdatingConfiguration = true;
    try {
      for (const joint of this.joints) {
        this.kinematicTree.updateTheta(joint.name, joint.value);
      }
      this.updateRobotVisualization();
    } catch (error) {
      console.error('Error updating joint:', error);
    } finally {
      this.isUpdatingConfiguration = false;
    }
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

    try {
      // Clear existing robot
      this.clearRobot();

      // Delete old kinematic tree to free WASM memory
      if (this.kinematicTree) {
        try {
          this.kinematicTree.delete();
        } catch (e) {
          console.warn('Failed to delete kinematic tree:', e);
        }
        this.kinematicTree = null;
      }

      const urdfResponse = await fetch(`/assets/urdf/${urdfName}.urdf`);

      if (!urdfResponse.ok) {
        throw new Error(`Failed to fetch URDF: ${urdfResponse.status} ${urdfResponse.statusText}`);
      }

      const urdfContent = await urdfResponse.text();

      if (!urdfContent || urdfContent.trim().length === 0) {
        throw new Error('URDF file is empty');
      }

      try {
        this.kinematicTree = this.wasmModule.loadUrdfFromString(urdfContent);
      } catch (wasmError) {
        throw new Error(`Failed to parse URDF: ${wasmError}`);
      }

      this.rootLink = this.wasmModule.getRootLink(this.kinematicTree) || 'base_link';
      this.extractJointInfo();
      this.buildRobot();

      // Clear point cloud when switching robots
      if (this.pointCloud) {
        this.scene.remove(this.pointCloud.points);
        this.pointCloud.geometry.dispose();
        this.pointCloud.material.dispose();
        this.pointCloud = null;
        this.manipulabilityRange = { min: Infinity, max: -Infinity };
        this.conditionNumberRange = { min: Infinity, max: -Infinity };
        this.orientationManipulabilityRange = { min: Infinity, max: -Infinity };
        this.orientationConditionNumberRange = { min: Infinity, max: -Infinity };
        this.averageManipulability = null;
        this.averageConditionNumber = null;
        this.averageOrientationManipulability = null;
        this.averageOrientationConditionNumber = null;
      }

      // Clear workspace volume when switching robots
      if (this.workspaceVolume) {
        this.scene.remove(this.workspaceVolume.mesh);

        // Add cleanup for wireframe
        if (this.workspaceVolume.wireframe) {
          this.scene.remove(this.workspaceVolume.wireframe);
          (this.workspaceVolume.wireframe.geometry as THREE.EdgesGeometry).dispose();
          (this.workspaceVolume.wireframe.material as THREE.LineBasicMaterial).dispose();
        }

        this.workspaceVolume.geometry.dispose();
        this.workspaceVolume.material.dispose();
        this.workspaceVolume = null;
      }
      this.optimalVoxelSize = null;
      this.cachedVoxelMap = null;
      this.cachedConnectedVoxels = null;

      // Clear any previous error
      this.errorMessage = null;
    } catch (error: any) {
      const errorMsg = `Failed to load URDF "${urdfName}": ${error.message || String(error)}`;
      console.error(errorMsg, error);
      this.errorMessage = errorMsg;
      throw error;
    }
  }

  private clearRobot(): void {
    // Remove all link groups and meshes
    this.linkGroups.forEach(group => {
      // Clean up CSS2DObject labels before removing group
      group.traverse((obj) => {
        if (obj instanceof CSS2DObject) {
          obj.removeFromParent();
          obj.element.remove();
        }
      });
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

    // Clean up selected point marker
    if (this.selectedPointMarker) {
      this.scene.remove(this.selectedPointMarker);
      this.selectedPointMarker.geometry.dispose();
      (this.selectedPointMarker.material as THREE.Material).dispose();
      this.selectedPointMarker = null;
    }
  }

  async onUrdfChange(): Promise<void> {
    this.loading = true;
    try {
      await this.loadUrdf(this.selectedUrdf);
    } catch (e: any) {
      this.errorMessage = e.message || String(e);

      // If URDF loading failed with a WASM error, try reloading the WASM module
      console.warn('URDF load failed, attempting WASM module reload...');
      try {
        await this.loadWasm();
      } catch (reloadError) {
        console.error('WASM reload also failed:', reloadError);
      }
    }
    this.loading = false;
  }

  onTargetLinkChange(): void {
    // Update manipulability calculations with new target link
    if (!this.wasmModule || !this.kinematicTree) return;

    // Update current manipulability visualization
    if (this.showManipulabilityEllipsoid) {
      this.createManipulabilityEllipsoidVisualization();
    }

    // Regenerate point cloud if one exists
    if (this.pointCloud) {
      this.regeneratePointCloud();
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

    // Populate available links for target link selection
    this.availableLinks = [...linkNames];

    // Set default target link if not already set or if current selection is invalid
    if (!this.targetLink || !this.availableLinks.includes(this.targetLink)) {
      if (linkNames.includes('ee_link')) {
        this.targetLink = 'ee_link';
      } else if (linkNames.length > 0) {
        this.targetLink = linkNames[linkNames.length - 1]; // Use last link as default
      }
    }

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

    // Set initial visibility state for frames
    this.onShowFramesChange();
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

    // Update end-effector pose display
    const eeGroup = this.linkGroups.get(this.targetLink);
    if (eeGroup) {
      this.eePosition = eeGroup.position.clone();
      this.eeQuaternion = eeGroup.quaternion.clone();
    }

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

    // Set initial frame visibility (will be called again when robot loads, but sets initial state for world axes)
    this.onShowFramesChange();
  }

  private initClippingPlanes(): void {
    // Create two semi-transparent planes
    const planeGeometry = new THREE.PlaneGeometry(2, 2);
    const planeMaterial1 = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false  // Don't block objects behind the plane
    });
    const planeMaterial2 = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false  // Don't block objects behind the plane
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

    canvas.addEventListener('mousedown', (event) => this.onCanvasMouseDown(event), false);
    canvas.addEventListener('mousemove', (event) => this.onCanvasMouseMove(event), false);
    canvas.addEventListener('mouseup', () => this.onCanvasMouseUp(), false);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault(), false);
  }

  private onCanvasMouseDown(event: MouseEvent): void {
    // Only respond to left-click
    if (event.button !== 0) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Check if clicking on arrows first (priority over points)
    if (this.showClippingPlanes) {
      this.raycaster.setFromCamera(this.mouse, this.camera);

      const arrowObjects: THREE.Object3D[] = [];
      if (this.arrow1) {
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
          return;
        }
      }
    }

    // If not clicking on arrows, check for point cloud
    if (this.pointCloud && this.pointCloud.visible) {
      const selectedPoint = this.findClosestPointInScreenSpace(this.mouse.x, this.mouse.y);
      if (selectedPoint) {
        this.isDraggingPoints = true;
        this.controls.enabled = false;
        this.applyPointConfiguration(selectedPoint);
        event.preventDefault();
      }
    }
  }

  private onCanvasMouseMove(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Handle arrow dragging
    if (this.dragArrow) {
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

      // Visually filter display (doesn't recalculate voxel grid)
      this.updatePointCloudFiltering();
      this.updateWorkspaceVolumeFiltering();
      return;
    }

    // Handle point cloud dragging (throttled to prevent overwhelming WASM)
    if (this.isDraggingPoints && this.pointCloud && this.pointCloud.visible) {
      const now = performance.now();
      if (now - this.lastUpdateTime >= this.UPDATE_THROTTLE_MS) {
        const selectedPoint = this.findClosestPointInScreenSpace(this.mouse.x, this.mouse.y);
        if (selectedPoint) {
          this.applyPointConfiguration(selectedPoint);
          this.lastUpdateTime = now;
        }
      }
    }
  }

  private onCanvasMouseUp(): void {
    if (this.dragArrow || this.isDraggingPoints) {
      this.dragArrow = null;
      this.isDraggingPoints = false;
      this.controls.enabled = true;
      // Note: Filtering happens during drag, no need to update on mouse up
    }
  }

  private findClosestPointInScreenSpace(mouseX: number, mouseY: number): MonteCarloPoint | null {
    if (!this.pointCloud) return null;

    let closestPoint: MonteCarloPoint | null = null;
    let minDepth = Infinity;
    const clickThreshold = 0.03; // ~15 pixels at 1920px width

    // Temporary vector for projection (reuse to avoid allocations)
    const projected = new THREE.Vector3();

    // Get plane data if filtering is enabled
    let plane1Normal: THREE.Vector3 | undefined;
    let plane1Point: THREE.Vector3 | undefined;
    let plane2Normal: THREE.Vector3 | undefined;
    let plane2Point: THREE.Vector3 | undefined;
    let tempVec: THREE.Vector3 | undefined;
    const shouldFilter = this.enablePlaneFiltering && this.plane1 && this.plane2;

    if (shouldFilter) {
      plane1Normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.plane1!.quaternion);
      plane1Point = this.plane1!.position.clone();
      plane2Normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.plane2!.quaternion);
      plane2Point = this.plane2!.position.clone();
      tempVec = new THREE.Vector3();
    }

    for (const point of this.pointCloud.data) {
      // Project point to screen space
      projected.copy(point.position).project(this.camera);

      // Calculate screen-space distance
      const dx = projected.x - mouseX;
      const dy = projected.y - mouseY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Check if within threshold
      if (distance < clickThreshold) {
        // Check if point is between planes (if filtering enabled)
        if (shouldFilter) {
          tempVec!.copy(point.position).sub(plane1Point!);
          const dist1 = plane1Normal!.dot(tempVec!);
          tempVec!.copy(point.position).sub(plane2Point!);
          const dist2 = plane2Normal!.dot(tempVec!);
          const isBetween = (dist1 >= 0 && dist2 <= 0) || (dist1 <= 0 && dist2 >= 0);

          if (!isBetween) continue; // Skip points outside plane region
        }

        // Among points within threshold, select the one closest to camera (smallest Z)
        if (projected.z < minDepth) {
          minDepth = projected.z;
          closestPoint = point;
        }
      }
    }

    return closestPoint;
  }

  private applyPointConfiguration(point: MonteCarloPoint): void {
    // Prevent re-entrant calls that can corrupt WASM memory
    if (this.isUpdatingConfiguration) {
      return;
    }

    if (!this.wasmModule || !this.kinematicTree) return;

    // Validate point configuration before applying
    if (!point.jointConfig || point.jointConfig.length !== this.joints.length) {
      console.warn('Invalid joint configuration length');
      return;
    }

    // Validate all values are finite numbers within bounds
    for (let i = 0; i < this.joints.length; i++) {
      const value = point.jointConfig[i];
      if (!isFinite(value) || value < this.joints[i].lower || value > this.joints[i].upper) {
        console.warn(`Invalid joint value at index ${i}: ${value}`);
        return;
      }
    }

    this.isUpdatingConfiguration = true;

    try {
      console.log('Jumping to configuration:', {
        manipulability: point.manipulability.toFixed(6),
        conditionNumber: point.conditionNumber.toFixed(2),
        config: point.jointConfig.map(v => (v * 180 / Math.PI).toFixed(1) + '°')
      });

      // Update joint values in UI
      for (let i = 0; i < this.joints.length; i++) {
        this.joints[i].value = point.jointConfig[i];
      }

      // Update kinematic tree with error handling for each joint
      for (let i = 0; i < this.joints.length; i++) {
        try {
          this.kinematicTree.updateTheta(this.joints[i].name, point.jointConfig[i]);
        } catch (error) {
          console.error(`Failed to update theta for joint ${this.joints[i].name}:`, error);
          this.isUpdatingConfiguration = false;
          return; // Stop if any update fails
        }
      }

      // Update robot visualization
      this.updateRobotVisualization();

      // Highlight selected point
      this.highlightSelectedPoint(point);
    } catch (error) {
      console.error('Error applying point configuration:', error);
    } finally {
      this.isUpdatingConfiguration = false;
    }
  }

  private highlightSelectedPoint(point: MonteCarloPoint): void {
    // Remove previous marker
    if (this.selectedPointMarker) {
      this.scene.remove(this.selectedPointMarker);
      this.selectedPointMarker.geometry.dispose();
      (this.selectedPointMarker.material as THREE.Material).dispose();
    }

    // Create highlight sphere at selected point
    const geometry = new THREE.SphereGeometry(0.03, 16, 12);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffff00,  // Yellow highlight
      transparent: true,
      opacity: 0.8,
      depthTest: false  // Always visible
    });

    this.selectedPointMarker = new THREE.Mesh(geometry, material);
    this.selectedPointMarker.position.copy(point.position);
    this.scene.add(this.selectedPointMarker);

    // Fade out after 2 seconds
    setTimeout(() => {
      if (this.selectedPointMarker) {
        this.scene.remove(this.selectedPointMarker);
        this.selectedPointMarker.geometry.dispose();
        (this.selectedPointMarker.material as THREE.Material).dispose();
        this.selectedPointMarker = null;
      }
    }, 2000);
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

  private calculateConvexHullVolume(geometry: ConvexGeometry): number {
    const position = geometry.attributes['position'];
    if (!position) {
      console.warn('Invalid geometry for volume calculation - no position attribute');
      return 0;
    }

    // Check if geometry has index, if not compute it
    if (!geometry.index) {
      geometry.computeVertexNormals();
      // For non-indexed geometry, vertices are already in triangle order (every 3 vertices = 1 triangle)
    }

    const index = geometry.index;
    const vertexCount = position.count;

    // Calculate centroid of all vertices
    const centroid = new THREE.Vector3();
    for (let i = 0; i < vertexCount; i++) {
      centroid.x += position.getX(i);
      centroid.y += position.getY(i);
      centroid.z += position.getZ(i);
    }
    centroid.divideScalar(vertexCount);

    // Calculate volume by summing tetrahedra formed by each triangle and the centroid
    let volume = 0;

    if (index) {
      // Indexed geometry
      for (let i = 0; i < index.count; i += 3) {
        const i0 = index.getX(i);
        const i1 = index.getX(i + 1);
        const i2 = index.getX(i + 2);

        // Get triangle vertices relative to centroid
        const v0 = new THREE.Vector3(
          position.getX(i0) - centroid.x,
          position.getY(i0) - centroid.y,
          position.getZ(i0) - centroid.z
        );
        const v1 = new THREE.Vector3(
          position.getX(i1) - centroid.x,
          position.getY(i1) - centroid.y,
          position.getZ(i1) - centroid.z
        );
        const v2 = new THREE.Vector3(
          position.getX(i2) - centroid.x,
          position.getY(i2) - centroid.y,
          position.getZ(i2) - centroid.z
        );

        // Signed volume of tetrahedron formed by triangle and centroid
        // V = (1/6) * v0 · (v1 × v2)
        volume += v0.dot(v1.clone().cross(v2)) / 6.0;
      }
      console.log(`Convex hull (indexed): ${index.count / 3} triangles, ${vertexCount} vertices`);
    } else {
      // Non-indexed geometry - every 3 consecutive vertices form a triangle
      for (let i = 0; i < vertexCount; i += 3) {
        // Get triangle vertices relative to centroid
        const v0 = new THREE.Vector3(
          position.getX(i) - centroid.x,
          position.getY(i) - centroid.y,
          position.getZ(i) - centroid.z
        );
        const v1 = new THREE.Vector3(
          position.getX(i + 1) - centroid.x,
          position.getY(i + 1) - centroid.y,
          position.getZ(i + 1) - centroid.z
        );
        const v2 = new THREE.Vector3(
          position.getX(i + 2) - centroid.x,
          position.getY(i + 2) - centroid.y,
          position.getZ(i + 2) - centroid.z
        );

        // Signed volume of tetrahedron formed by triangle and centroid
        volume += v0.dot(v1.clone().cross(v2)) / 6.0;
      }
      console.log(`Convex hull (non-indexed): ${vertexCount / 3} triangles, ${vertexCount} vertices`);
    }

    const finalVolume = Math.abs(volume);
    console.log(`Convex hull volume: ${finalVolume.toFixed(6)} m³`);
    return finalVolume;
  }

  private calculateVoxelVolume(points: THREE.Vector3[], voxelSize: number): { volume: number; voxelGeometry: THREE.BufferGeometry } {
    // Find bounding box
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

    for (const point of points) {
      min.min(point);
      max.max(point);
    }

    // Create voxel grid using Set for fast lookup
    const voxelSet = new Set<string>();

    for (const point of points) {
      // Calculate voxel coordinates
      const vx = Math.floor((point.x - min.x) / voxelSize);
      const vy = Math.floor((point.y - min.y) / voxelSize);
      const vz = Math.floor((point.z - min.z) / voxelSize);

      const key = `${vx},${vy},${vz}`;
      voxelSet.add(key);
    }

    const occupiedVoxels = voxelSet.size;
    const voxelVolume = voxelSize * voxelSize * voxelSize;
    const totalVolume = occupiedVoxels * voxelVolume;

    // Create visualization geometry (sample of voxels to avoid too many cubes)
    const maxVoxelsToShow = 20000;  // Increased from 1000 - render up to 20k voxels without sampling
    const voxelArray = Array.from(voxelSet);
    const step = Math.max(1, Math.floor(voxelArray.length / maxVoxelsToShow));

    const positions: number[] = [];
    const boxGeometry = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
    const matrix = new THREE.Matrix4();

    for (let i = 0; i < voxelArray.length; i += step) {
      const [vx, vy, vz] = voxelArray[i].split(',').map(Number);

      const x = min.x + (vx + 0.5) * voxelSize;
      const y = min.y + (vy + 0.5) * voxelSize;
      const z = min.z + (vz + 0.5) * voxelSize;

      matrix.setPosition(x, y, z);

      // Merge box geometry into positions
      const posAttr = boxGeometry.attributes['position'];
      for (let j = 0; j < posAttr.count; j++) {
        const v = new THREE.Vector3(
          posAttr.getX(j),
          posAttr.getY(j),
          posAttr.getZ(j)
        );
        v.applyMatrix4(matrix);
        positions.push(v.x, v.y, v.z);
      }
    }

    const voxelGeometry = new THREE.BufferGeometry();
    voxelGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    return { volume: totalVolume, voxelGeometry };
  }

  private testVoxelConnectivity(
    points: THREE.Vector3[],
    voxelSize: number
  ): { isFullyConnected: boolean; connectedCount: number; totalCount: number } {

    // Build voxel grid
    const bbox = new THREE.Box3().setFromPoints(points);
    const min = bbox.min;
    const voxelSet = new Set<string>();

    for (const point of points) {
      const vx = Math.floor((point.x - min.x) / voxelSize);
      const vy = Math.floor((point.y - min.y) / voxelSize);
      const vz = Math.floor((point.z - min.z) / voxelSize);
      voxelSet.add(`${vx},${vy},${vz}`);
    }

    const totalCount = voxelSet.size;
    if (totalCount === 0) {
      return { isFullyConnected: false, connectedCount: 0, totalCount: 0 };
    }

    // BFS from starting voxel (closest to origin)
    const voxelKeys = Array.from(voxelSet);
    const startKey = voxelKeys[0]; // Could optimize by finding closest to base

    const connected = new Set<string>([startKey]);
    const queue = [startKey];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const [vx, vy, vz] = current.split(',').map(Number);

      // Check 6 neighbors
      const neighbors = [
        [vx+1, vy, vz], [vx-1, vy, vz],
        [vx, vy+1, vz], [vx, vy-1, vz],
        [vx, vy, vz+1], [vx, vy, vz-1]
      ];

      for (const [nx, ny, nz] of neighbors) {
        const neighborKey = `${nx},${ny},${nz}`;
        if (voxelSet.has(neighborKey) && !connected.has(neighborKey)) {
          connected.add(neighborKey);
          queue.push(neighborKey);
        }
      }
    }

    return {
      isFullyConnected: connected.size === totalCount,
      connectedCount: connected.size,
      totalCount
    };
  }

  private calculateVoxelVolumeWithConnectivity(
    points: THREE.Vector3[],
    voxelSize: number
  ): { volume: number; voxelGeometry: THREE.BufferGeometry; voxelSize: number; voxelMap: Map<string, THREE.Vector3>; connected: Set<string> } {

    // Step 1: Build voxel grid with given voxel size
    const bbox = new THREE.Box3().setFromPoints(points);
    const min = bbox.min;
    const voxelMap = new Map<string, THREE.Vector3>(); // key -> voxel center position

    for (const point of points) {
      const vx = Math.floor((point.x - min.x) / voxelSize);
      const vy = Math.floor((point.y - min.y) / voxelSize);
      const vz = Math.floor((point.z - min.z) / voxelSize);

      const key = `${vx},${vy},${vz}`;
      if (!voxelMap.has(key)) {
        const center = new THREE.Vector3(
          min.x + (vx + 0.5) * voxelSize,
          min.y + (vy + 0.5) * voxelSize,
          min.z + (vz + 0.5) * voxelSize
        );
        voxelMap.set(key, center);
      }
    }

    // Step 2: Check connectivity for diagnostic purposes
    const voxelKeys = Array.from(voxelMap.keys());
    if (voxelKeys.length === 0) {
      return {
        volume: 0,
        voxelGeometry: new THREE.BufferGeometry(),
        voxelSize,
        voxelMap: new Map(),
        connected: new Set()
      };
    }

    // Start from voxel closest to origin (robot base)
    const origin = new THREE.Vector3(0, 0, 0);
    let startKey = voxelKeys[0];
    let minDist = Infinity;
    for (const key of voxelKeys) {
      const dist = voxelMap.get(key)!.distanceTo(origin);
      if (dist < minDist) {
        minDist = dist;
        startKey = key;
      }
    }

    // BFS to find connected voxels (for diagnostics)
    const connected = new Set<string>();
    const queue = [startKey];
    connected.add(startKey);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const [vx, vy, vz] = current.split(',').map(Number);

      // Check 6 neighbors (±x, ±y, ±z)
      const neighbors = [
        [vx+1, vy, vz], [vx-1, vy, vz],
        [vx, vy+1, vz], [vx, vy-1, vz],
        [vx, vy, vz+1], [vx, vy, vz-1]
      ];

      for (const [nx, ny, nz] of neighbors) {
        const neighborKey = `${nx},${ny},${nz}`;
        if (voxelMap.has(neighborKey) && !connected.has(neighborKey)) {
          connected.add(neighborKey);
          queue.push(neighborKey);
        }
      }
    }

    // Step 3: Verify connectivity and calculate volume
    const voxelVolume = voxelSize ** 3;

    if (connected.size < voxelMap.size) {
      const disconnectedCount = voxelMap.size - connected.size;
      console.error(`ERROR: Algorithm produced disconnected voxels!`);
      console.error(`  Total voxels: ${voxelMap.size}, Connected: ${connected.size}`);
      console.error(`  Disconnected: ${disconnectedCount} (${(100 * disconnectedCount / voxelMap.size).toFixed(1)}%)`);
      console.error(`  This should not happen - binary search should have prevented this!`);
    }

    const totalVolume = connected.size * voxelVolume;

    // Step 4: Create visualization geometry from connected voxels
    const positions: number[] = [];
    const boxGeometry = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
    const matrix = new THREE.Matrix4();

    const maxVoxelsToShow = 20000;  // Increased from 1000 - render up to 20k voxels without sampling
    const connectedArray = Array.from(connected);
    const step = Math.max(1, Math.floor(connectedArray.length / maxVoxelsToShow));

    for (let i = 0; i < connectedArray.length; i += step) {
      const center = voxelMap.get(connectedArray[i])!;
      matrix.setPosition(center);

      const posAttr = boxGeometry.attributes['position'];
      for (let j = 0; j < posAttr.count; j++) {
        const v = new THREE.Vector3(
          posAttr.getX(j),
          posAttr.getY(j),
          posAttr.getZ(j)
        );
        v.applyMatrix4(matrix);
        positions.push(v.x, v.y, v.z);
      }
    }

    const voxelGeometry = new THREE.BufferGeometry();
    voxelGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const voxelsRendered = Math.ceil(connectedArray.length / step);
    console.log(`Voxel volume (adaptive): ${totalVolume.toFixed(6)} m³`);
    console.log(`  Total voxels: ${voxelMap.size}, Connected: ${connected.size}, Voxel size: ${voxelSize.toFixed(4)} m`);
    console.log(`  Visualization: rendering ${voxelsRendered} of ${connected.size} voxels (step=${step})`);

    return { volume: totalVolume, voxelGeometry, voxelSize, voxelMap, connected };
  }

  private calculateAdaptiveVoxelVolume(
    points: THREE.Vector3[]
  ): { volume: number; voxelGeometry: THREE.BufferGeometry; voxelSize: number; voxelMap: Map<string, THREE.Vector3>; connected: Set<string> } {

    // Calculate search bounds
    const bbox = new THREE.Box3().setFromPoints(points);
    const size = bbox.getSize(new THREE.Vector3());
    const bboxVolume = size.x * size.y * size.z;
    const avgVolumePerPoint = bboxVolume / points.length;
    const avgSpacing = Math.pow(avgVolumePerPoint, 1/3);

    let minVoxelSize = avgSpacing * 0.2;  // Fine resolution (likely disconnected)
    let maxVoxelSize = avgSpacing * 3.0;  // Coarse resolution (definitely connected)
    const tolerance = avgSpacing * 0.01;  // Convergence threshold

    console.log(`=== Adaptive Voxel Binary Search ===`);
    console.log(`Points: ${points.length}, Avg spacing: ${avgSpacing.toFixed(4)} m`);
    console.log(`Search range: [${minVoxelSize.toFixed(4)}, ${maxVoxelSize.toFixed(4)}], tolerance: ${tolerance.toFixed(6)}`);

    // First, verify that maxVoxelSize produces a connected workspace
    let initialTest = this.testVoxelConnectivity(points, maxVoxelSize);
    console.log(`Initial max size test: ${maxVoxelSize.toFixed(4)} → ${initialTest.connectedCount}/${initialTest.totalCount} ${initialTest.isFullyConnected ? '✓' : '✗'}`);

    if (!initialTest.isFullyConnected) {
      console.warn(`Warning: Even at maximum voxel size (${maxVoxelSize.toFixed(4)} m), workspace is disconnected!`);
      console.warn(`Increasing voxel size to find connected configuration...`);
      // Increase maxVoxelSize until we find a connected configuration
      // Use a more aggressive limit (20x instead of 10x)
      while (!initialTest.isFullyConnected && maxVoxelSize < avgSpacing * 20) {
        maxVoxelSize *= 1.5;
        initialTest = this.testVoxelConnectivity(points, maxVoxelSize);
        console.log(`  Retry with larger size: ${maxVoxelSize.toFixed(4)} → ${initialTest.connectedCount}/${initialTest.totalCount} ${initialTest.isFullyConnected ? '✓' : '✗'}`);
      }
    }

    let bestVoxelSize = maxVoxelSize;
    let bestIsConnected = initialTest.isFullyConnected;
    let iteration = 0;
    const maxIterations = 20; // Prevent infinite loops

    // Binary search for optimal voxel size
    while (maxVoxelSize - minVoxelSize > tolerance && iteration < maxIterations) {
      iteration++;
      const testVoxelSize = (minVoxelSize + maxVoxelSize) / 2;

      // Test connectivity at this voxel size
      const { isFullyConnected, connectedCount, totalCount } =
        this.testVoxelConnectivity(points, testVoxelSize);

      console.log(`  Iteration ${iteration}: size=${testVoxelSize.toFixed(4)}, connected=${connectedCount}/${totalCount} ${isFullyConnected ? '✓' : '✗'}`);

      if (isFullyConnected) {
        // Connected - try smaller voxels for better resolution
        bestVoxelSize = testVoxelSize;
        bestIsConnected = true;
        maxVoxelSize = testVoxelSize;
      } else {
        // Disconnected - need larger voxels
        minVoxelSize = testVoxelSize;
      }
    }

    console.log(`Binary search complete: bestVoxelSize=${bestVoxelSize.toFixed(4)} m, connected=${bestIsConnected} (after ${iteration} iterations)`);

    // If binary search failed to find connected region, try increasing size
    if (!bestIsConnected) {
      console.warn(`Binary search did not find connected region. Trying larger voxel sizes...`);
      let retrySize = bestVoxelSize * 1.5;
      let retryCount = 0;
      while (!bestIsConnected && retryCount < 10 && retrySize < avgSpacing * 50) {
        retryCount++;
        const retryTest = this.testVoxelConnectivity(points, retrySize);
        console.log(`  Retry ${retryCount}: size=${retrySize.toFixed(4)} → ${retryTest.connectedCount}/${retryTest.totalCount} ${retryTest.isFullyConnected ? '✓' : '✗'}`);
        if (retryTest.isFullyConnected) {
          bestVoxelSize = retrySize;
          bestIsConnected = true;
          console.log(`Found connected region at size ${retrySize.toFixed(4)} m`);
          break;
        }
        retrySize *= 1.5;
      }
    }

    if (!bestIsConnected) {
      console.error(`ERROR: Could not find a fully connected voxel size after all attempts!`);
      console.error(`This indicates the workspace has disconnected regions that cannot be bridged.`);
      console.error(`Using best available size: ${bestVoxelSize.toFixed(4)} m`);
    }

    console.log(`Building final voxel grid...`);

    // Build final voxel grid at optimal size
    return this.calculateVoxelVolumeWithConnectivity(points, bestVoxelSize);
  }

  private createWorkspaceVolumeVisualizationFromFilteredVoxels(voxelKeysToShow: Set<string>): void {
    // Clean up existing
    if (this.workspaceVolume) {
      this.scene.remove(this.workspaceVolume.mesh);

      // Add cleanup for wireframe
      if (this.workspaceVolume.wireframe) {
        this.scene.remove(this.workspaceVolume.wireframe);
        (this.workspaceVolume.wireframe.geometry as THREE.EdgesGeometry).dispose();
        (this.workspaceVolume.wireframe.material as THREE.LineBasicMaterial).dispose();
      }

      this.workspaceVolume.geometry.dispose();
      this.workspaceVolume.material.dispose();
      this.workspaceVolume = null;
    }

    if (!this.cachedVoxelMap || !this.optimalVoxelSize) {
      console.error('Cannot filter voxels - no cached voxel data');
      return;
    }

    const voxelSize = this.optimalVoxelSize;
    const voxelVolume = voxelSize ** 3;
    const totalVolume = voxelKeysToShow.size * voxelVolume;

    // Create visualization geometry from filtered voxels
    const positions: number[] = [];
    const boxGeometry = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
    const matrix = new THREE.Matrix4();

    const maxVoxelsToShow = 20000;
    const voxelsArray = Array.from(voxelKeysToShow);
    const step = Math.max(1, Math.floor(voxelsArray.length / maxVoxelsToShow));

    for (let i = 0; i < voxelsArray.length; i += step) {
      const center = this.cachedVoxelMap.get(voxelsArray[i])!;
      matrix.setPosition(center);

      const posAttr = boxGeometry.attributes['position'];
      for (let j = 0; j < posAttr.count; j++) {
        const v = new THREE.Vector3(
          posAttr.getX(j),
          posAttr.getY(j),
          posAttr.getZ(j)
        );
        v.applyMatrix4(matrix);
        positions.push(v.x, v.y, v.z);
      }
    }

    const voxelGeometry = new THREE.BufferGeometry();
    voxelGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false  // Add depth configuration
    });

    // Create separate wireframe edges for better visibility
    const edges = new THREE.EdgesGeometry(voxelGeometry);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.4,  // Translucent edges
      depthWrite: false,
      depthTest: true
    });
    const wireframe = new THREE.LineSegments(edges, edgeMaterial);

    const mesh = new THREE.Mesh(voxelGeometry, material);
    mesh.visible = this.showWorkspaceVolume;
    mesh.renderOrder = 1;
    this.scene.add(mesh);

    wireframe.visible = this.showWorkspaceVolume;
    wireframe.renderOrder = 2;
    this.scene.add(wireframe);

    this.workspaceVolume = { mesh, wireframe, geometry: voxelGeometry, material, volume: totalVolume, voxelSize };

    console.log(`Filtered volume: ${totalVolume.toFixed(6)} m³ (${voxelsArray.length} voxels)`);
  }

  private createWorkspaceVolumeVisualization(points: THREE.Vector3[]): void {
    // Clean up existing
    if (this.workspaceVolume) {
      this.scene.remove(this.workspaceVolume.mesh);

      // Add cleanup for wireframe
      if (this.workspaceVolume.wireframe) {
        this.scene.remove(this.workspaceVolume.wireframe);
        (this.workspaceVolume.wireframe.geometry as THREE.EdgesGeometry).dispose();
        (this.workspaceVolume.wireframe.material as THREE.LineBasicMaterial).dispose();
      }

      this.workspaceVolume.geometry.dispose();
      this.workspaceVolume.material.dispose();
      this.workspaceVolume = null;
    }

    if (points.length < 4) {
      console.warn('Need at least 4 points to estimate workspace volume');
      return;
    }

    try {
      if (this.volumeMethod === 'convex') {
        // Convex hull approach
        const geometry = new ConvexGeometry(points);
        const volume = this.calculateConvexHullVolume(geometry);

        const material = new THREE.MeshBasicMaterial({
          color: 0x00ff88,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide
        });

        // Add wireframe edges
        const edges = new THREE.EdgesGeometry(geometry);
        const edgeMaterial = new THREE.LineBasicMaterial({
          color: 0x00ff88,
          transparent: true,
          opacity: 0.2,  // Translucent edges
          depthWrite: false,  // Don't write to depth buffer (like clipping planes)
          depthTest: true  // Still test depth for proper layering
        });
        const wireframe = new THREE.LineSegments(edges, edgeMaterial);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.visible = this.showWorkspaceVolume;
        mesh.renderOrder = 1;  // Render mesh first
        this.scene.add(mesh);

        wireframe.visible = this.showWorkspaceVolume;
        wireframe.renderOrder = 2;  // Render wireframe after mesh
        this.scene.add(wireframe);  // Add as scene sibling

        this.workspaceVolume = { mesh, wireframe, geometry, material, volume };

        console.log(`Workspace volume (convex hull): ${volume.toFixed(6)} m³`);
      } else {
        // Adaptive voxel approach - calculate and cache voxel grid
        const { volume, voxelGeometry, voxelSize, voxelMap, connected } = this.calculateAdaptiveVoxelVolume(points);

        // Cache everything for filtering operations
        this.optimalVoxelSize = voxelSize;
        this.cachedVoxelMap = voxelMap;
        this.cachedConnectedVoxels = connected;

        const material = new THREE.MeshBasicMaterial({
          color: 0x00ffff,
          transparent: true,
          opacity: 0.1,
          side: THREE.DoubleSide,
          depthWrite: false  // Add depth configuration
        });

        // Create separate wireframe edges for better visibility
        const edges = new THREE.EdgesGeometry(voxelGeometry);
        const edgeMaterial = new THREE.LineBasicMaterial({
          color: 0x00ffff,
          transparent: true,
          opacity: 0.2,  // Translucent edges
          depthWrite: false,
          depthTest: true
        });
        const wireframe = new THREE.LineSegments(edges, edgeMaterial);

        const mesh = new THREE.Mesh(voxelGeometry, material);
        mesh.visible = this.showWorkspaceVolume;
        mesh.renderOrder = 1;
        this.scene.add(mesh);

        wireframe.visible = this.showWorkspaceVolume;
        wireframe.renderOrder = 2;
        this.scene.add(wireframe);

        this.workspaceVolume = { mesh, wireframe, geometry: voxelGeometry, material, volume, voxelSize };
      }
    } catch (error) {
      console.error('Failed to create workspace volume visualization:', error);
    }
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
      switch (this.manipulabilityMetric) {
        case 'volume':
          value = mcPoint.manipulability;
          minVal = this.manipulabilityRange.min;
          maxVal = this.manipulabilityRange.max;
          break;
        case 'condition':
          value = mcPoint.conditionNumber;
          minVal = this.conditionNumberRange.min;
          maxVal = this.conditionNumberRange.max;
          break;
        case 'orientation_volume':
          value = mcPoint.orientationManipulability;
          minVal = this.orientationManipulabilityRange.min;
          maxVal = this.orientationManipulabilityRange.max;
          break;
        case 'orientation_condition':
          value = mcPoint.orientationConditionNumber;
          minVal = this.orientationConditionNumberRange.min;
          maxVal = this.orientationConditionNumberRange.max;
          break;
      }

      // Color mapping: Blue (good) → Red (bad/singularities)
      const color = this.manipulabilityToColor(value, minVal, maxVal);
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
      depthWrite: true
    });

    const points = new THREE.Points(geometry, material);
    points.visible = true;  // Always show after generation
    this.showPointCloud = true;  // Update UI state
    this.scene.add(points);

    this.pointCloud = { points, geometry, material, data: mcPoints, visible: this.showPointCloud };

    // Calculate average manipulability measures
    if (mcPoints.length > 0) {
      let sumManip = 0, sumCond = 0, sumOrientManip = 0, sumOrientCond = 0;
      for (const point of mcPoints) {
        sumManip += point.manipulability;
        sumCond += point.conditionNumber;
        sumOrientManip += point.orientationManipulability;
        sumOrientCond += point.orientationConditionNumber;
      }
      this.averageManipulability = sumManip / mcPoints.length;
      this.averageConditionNumber = sumCond / mcPoints.length;
      this.averageOrientationManipulability = sumOrientManip / mcPoints.length;
      this.averageOrientationConditionNumber = sumOrientCond / mcPoints.length;
    } else {
      this.averageManipulability = null;
      this.averageConditionNumber = null;
      this.averageOrientationManipulability = null;
      this.averageOrientationConditionNumber = null;
    }

    // Create workspace volume visualization from all points
    // Note: If rejection sampling was used during generation, these points are already
    // within the plane bounds, so no further filtering is needed
    const workspacePoints = mcPoints.map(p => p.position.clone());
    this.createWorkspaceVolumeVisualization(workspacePoints);
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
    const filteredPoints: THREE.Vector3[] = [];

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
        filteredPoints.push(point.clone());

        // Color based on selected metric
        let value: number, minVal: number, maxVal: number;
        switch (this.manipulabilityMetric) {
          case 'volume':
            value = this.pointCloud.data[i].manipulability;
            minVal = this.manipulabilityRange.min;
            maxVal = this.manipulabilityRange.max;
            break;
          case 'condition':
            value = this.pointCloud.data[i].conditionNumber;
            minVal = this.conditionNumberRange.min;
            maxVal = this.conditionNumberRange.max;
            break;
          case 'orientation_volume':
            value = this.pointCloud.data[i].orientationManipulability;
            minVal = this.orientationManipulabilityRange.min;
            maxVal = this.orientationManipulabilityRange.max;
            break;
          case 'orientation_condition':
            value = this.pointCloud.data[i].orientationConditionNumber;
            minVal = this.orientationConditionNumberRange.min;
            maxVal = this.orientationConditionNumberRange.max;
            break;
        }

        const color = this.manipulabilityToColor(value, minVal, maxVal);
        newColors.push(color.r, color.g, color.b);
      }
    }

    // Update geometry
    this.pointCloud.geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    this.pointCloud.geometry.setAttribute('color', new THREE.Float32BufferAttribute(newColors, 3));
    this.pointCloud.geometry.attributes['position'].needsUpdate = true;
    this.pointCloud.geometry.attributes['color'].needsUpdate = true;
  }

  private updateWorkspaceVolumeFiltering(): void {
    if (!this.plane1 || !this.plane2) return;

    // Get plane normals and positions
    const plane1Normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.plane1.quaternion);
    const plane1Point = this.plane1.position.clone();
    const plane2Normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.plane2.quaternion);
    const plane2Point = this.plane2.position.clone();
    const tempVec = new THREE.Vector3();

    // Update workspace volume by filtering cached voxels (don't rebuild grid)
    if (this.cachedVoxelMap && this.cachedConnectedVoxels && this.volumeMethod === 'adaptive_voxel') {
      // Filter voxels between planes
      const filteredVoxels = new Set<string>();

      for (const voxelKey of this.cachedConnectedVoxels) {
        const voxelCenter = this.cachedVoxelMap.get(voxelKey)!;

        // Check if voxel center is between planes
        tempVec.copy(voxelCenter).sub(plane1Point);
        const dist1 = plane1Normal.dot(tempVec);

        tempVec.copy(voxelCenter).sub(plane2Point);
        const dist2 = plane2Normal.dot(tempVec);

        // Point is between planes if both distances have opposite signs or one is zero
        if (dist1 * dist2 <= 0) {
          filteredVoxels.add(voxelKey);
        }
      }

      // Visualize filtered voxels (no grid recalculation!)
      if (filteredVoxels.size > 0) {
        this.createWorkspaceVolumeVisualizationFromFilteredVoxels(filteredVoxels);
      }
    } else if (this.volumeMethod === 'convex' && this.pointCloud) {
      // Convex hull needs to be regenerated with filtered points
      const filteredPoints: THREE.Vector3[] = [];

      for (const mcPoint of this.pointCloud.data) {
        const point = mcPoint.position;

        tempVec.copy(point).sub(plane1Point);
        const dist1 = plane1Normal.dot(tempVec);

        tempVec.copy(point).sub(plane2Point);
        const dist2 = plane2Normal.dot(tempVec);

        if (dist1 * dist2 <= 0) {
          filteredPoints.push(point.clone());
        }
      }

      if (filteredPoints.length >= 4) {
        this.createWorkspaceVolumeVisualization(filteredPoints);
      }
    }
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
        this.targetLink,
        this.rootLink,
        jointNamesVec
      );
      jointNamesVec.delete();

      // Validate manipulability result
      if (!manip || !manip.posAxes || !manip.posValues || !manip.oriAxes || !manip.oriValues) {
        console.warn('Invalid manipulability result');
        return;
      }

      // Store current manipulability values
      this.currentManipulability = manip.wPos;
      this.currentOrientationManipulability = manip.wOri;

      // Calculate condition numbers (isotropy) from eigenvalues
      const posValues = this.extractValuesFromVector(manip.posValues);
      const oriValues = this.extractValuesFromVector(manip.oriValues);

      if (posValues.length === 3) {
        const posMax = Math.max(...posValues);
        const posMin = Math.min(...posValues.filter(v => v > 1e-10)); // Avoid division by very small numbers
        this.currentConditionNumber = posMin > 1e-10 ? posMin / posMax : 0;
      }

      if (oriValues.length === 3) {
        const oriMax = Math.max(...oriValues);
        const oriMin = Math.min(...oriValues.filter(v => v > 1e-10));
        this.currentOrientationConditionNumber = oriMin > 1e-10 ? oriMin / oriMax : 0;
      }

      // Get end-effector position
      const flatVec = this.wasmModule.fkFlat(this.kinematicTree, this.targetLink);
      const elements: number[] = [];
      for (let i = 0; i < 16; i++) elements.push(flatVec.get(i));
      flatVec.delete();

      const mat4 = new THREE.Matrix4().fromArray(elements);
      const eePosition = new THREE.Vector3().setFromMatrixPosition(mat4);

      // Extract ellipsoid data (posValues and oriValues already extracted above)
      const posAxes = this.extractAxesFromVector(manip.posAxes);
      const oriAxes = this.extractAxesFromVector(manip.oriAxes);

      // Create position ellipsoid (blue) with fixed 0.3 opacity
      const posEllipsoid = this.createEllipsoidMesh(
        eePosition, posAxes, posValues, 0x4488ff, 0.3
      );
      posEllipsoid.visible = this.showPositionEllipsoid && this.showManipulabilityEllipsoid;
      this.scene.add(posEllipsoid);

      // Create orientation ellipsoid (green, scaled by 0.1 for visibility) with fixed 0.3 opacity
      const scaledOriValues = oriValues.map(v => v * 0.1);
      const oriEllipsoid = this.createEllipsoidMesh(
        eePosition, oriAxes, scaledOriValues, 0x44ff44, 0.3
      );
      oriEllipsoid.visible = this.showOrientationEllipsoid && this.showManipulabilityEllipsoid;
      this.scene.add(oriEllipsoid);

      // Create axis arrows (always hidden)
      const posAxesGroup = this.createEllipsoidAxes(eePosition, posAxes, posValues, 0x0000ff);
      posAxesGroup.visible = false;
      this.scene.add(posAxesGroup);

      const oriAxesGroup = this.createEllipsoidAxes(eePosition, oriAxes, scaledOriValues, 0x00ff00);
      oriAxesGroup.visible = false;
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

  private manipulabilityToColor(value: number, min: number, max: number): THREE.Color {
    // Linear scale for both manipulability and reciprocal condition number (higher is better)
    const normalized = (max - min) > 0 ? (value - min) / (max - min) : 0.5;

    // Clamp to [0, 1]
    const clampedNormalized = Math.max(0, Math.min(1, normalized));

    // Map: 0 (bad) → red (0°), 1 (good) → blue (240°)
    // This creates a smooth transition: red → orange → yellow → green → cyan → blue
    const hue = clampedNormalized * 240;

    return new THREE.Color().setHSL(hue / 360, 1.0, 0.5);
  }

  onPointCloudVisibilityChange(): void {
    if (this.pointCloud) {
      this.pointCloud.points.visible = this.showPointCloud;
      this.pointCloud.visible = this.showPointCloud;
    }
  }

  onWorkspaceVolumeVisibilityChange(): void {
    if (this.workspaceVolume) {
      this.workspaceVolume.mesh.visible = this.showWorkspaceVolume;
      if (this.workspaceVolume.wireframe) {
        this.workspaceVolume.wireframe.visible = this.showWorkspaceVolume;
      }
    }
  }

  onVolumeMethodChange(): void {
    if (this.pointCloud) {
      // Clear cached data when switching methods (will be recalculated if needed)
      this.optimalVoxelSize = null;
      this.cachedVoxelMap = null;
      this.cachedConnectedVoxels = null;
      const points = this.pointCloud.data.map(p => p.position.clone());
      this.createWorkspaceVolumeVisualization(points);
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
    // When enabled: visually filter points/voxels between planes (doesn't recalculate)
    // When disabled: show all points/voxels
    // Also controls rejection sampling on next generation
    if (this.enablePlaneFiltering) {
      this.updatePointCloudFiltering();
      this.updateWorkspaceVolumeFiltering();
    } else {
      // Restore all points
      if (this.pointCloud) {
        const positions: number[] = [];
        const colors: number[] = [];
        const allPoints: THREE.Vector3[] = [];

        for (const mcPoint of this.pointCloud.data) {
          positions.push(mcPoint.position.x, mcPoint.position.y, mcPoint.position.z);
          allPoints.push(mcPoint.position.clone());

          // Color based on selected metric
          let value: number, minVal: number, maxVal: number;
          switch (this.manipulabilityMetric) {
            case 'volume':
              value = mcPoint.manipulability;
              minVal = this.manipulabilityRange.min;
              maxVal = this.manipulabilityRange.max;
              break;
            case 'condition':
              value = mcPoint.conditionNumber;
              minVal = this.conditionNumberRange.min;
              maxVal = this.conditionNumberRange.max;
              break;
            case 'orientation_volume':
              value = mcPoint.orientationManipulability;
              minVal = this.orientationManipulabilityRange.min;
              maxVal = this.orientationManipulabilityRange.max;
              break;
            case 'orientation_condition':
              value = mcPoint.orientationConditionNumber;
              minVal = this.orientationConditionNumberRange.min;
              maxVal = this.orientationConditionNumberRange.max;
              break;
          }

          const color = this.manipulabilityToColor(value, minVal, maxVal);
          colors.push(color.r, color.g, color.b);
        }

        this.pointCloud.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        this.pointCloud.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        this.pointCloud.geometry.attributes['position'].needsUpdate = true;
        this.pointCloud.geometry.attributes['color'].needsUpdate = true;

        // Restore workspace volume (doesn't recalculate grid, just shows all cached voxels)
        if (this.cachedConnectedVoxels && this.volumeMethod === 'adaptive_voxel') {
          this.createWorkspaceVolumeVisualizationFromFilteredVoxels(this.cachedConnectedVoxels);
        } else if (this.volumeMethod === 'convex') {
          this.createWorkspaceVolumeVisualization(allPoints);
        }
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
  }

  onOrientationEllipsoidVisibilityChange(): void {
    if (this.manipulabilityEllipsoid?.oriEllipsoid) {
      this.manipulabilityEllipsoid.oriEllipsoid.visible =
        this.showOrientationEllipsoid && this.showManipulabilityEllipsoid;
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
      // Also traverse world axes to set visibility on children (labels, etc.)
      worldAxes.traverse((obj) => {
        if (obj instanceof CSS2DObject) {
          obj.visible = this.showFrames;
        }
      });
    }
  }

  onManipulabilityMetricChange(): void {
    // Re-color the existing point cloud with the new metric
    if (this.pointCloud) {
      this.createPointCloudVisualization(this.pointCloud.data);
      // Re-apply plane filtering if active (createPointCloudVisualization renders all points)
      if (this.enablePlaneFiltering) {
        this.updatePointCloudFiltering();
      }
    }
  }

  async onLoadUrdfFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    input.value = ''; // allow re-loading the same file
    const urdfContent = await file.text();
    this.loading = true;
    try {
      await this.loadUrdfFromContent(urdfContent, file.name.replace(/\.urdf$/i, ''));
    } catch (e: any) {
      this.errorMessage = e.message || String(e);
    }
    this.loading = false;
  }

  private async loadUrdfFromContent(urdfContent: string, label: string): Promise<void> {
    if (!this.wasmModule) return;
    try {
      this.clearRobot();
      if (this.kinematicTree) {
        try { this.kinematicTree.delete(); } catch { /* ignore */ }
        this.kinematicTree = null;
      }
      if (!urdfContent || urdfContent.trim().length === 0) {
        throw new Error('URDF file is empty');
      }
      try {
        this.kinematicTree = this.wasmModule.loadUrdfFromString(urdfContent);
      } catch (wasmError) {
        throw new Error(`Failed to parse URDF: ${wasmError}`);
      }
      this.rootLink = this.wasmModule.getRootLink(this.kinematicTree) || 'base_link';
      this.extractJointInfo();
      this.buildRobot();
      if (this.pointCloud) {
        this.scene.remove(this.pointCloud.points);
        this.pointCloud.geometry.dispose();
        this.pointCloud.material.dispose();
        this.pointCloud = null;
        this.manipulabilityRange = { min: Infinity, max: -Infinity };
        this.conditionNumberRange = { min: Infinity, max: -Infinity };
        this.orientationManipulabilityRange = { min: Infinity, max: -Infinity };
        this.orientationConditionNumberRange = { min: Infinity, max: -Infinity };
        this.averageManipulability = null;
        this.averageConditionNumber = null;
        this.averageOrientationManipulability = null;
        this.averageOrientationConditionNumber = null;
      }
      if (this.workspaceVolume) {
        this.scene.remove(this.workspaceVolume.mesh);
        if (this.workspaceVolume.wireframe) {
          this.scene.remove(this.workspaceVolume.wireframe);
          (this.workspaceVolume.wireframe.geometry as THREE.EdgesGeometry).dispose();
          (this.workspaceVolume.wireframe.material as THREE.LineBasicMaterial).dispose();
        }
        this.workspaceVolume.geometry.dispose();
        this.workspaceVolume.material.dispose();
        this.workspaceVolume = null;
      }
      this.optimalVoxelSize = null;
      this.cachedVoxelMap = null;
      this.cachedConnectedVoxels = null;
      this.selectedUrdf = `[${label}]`;
      this.errorMessage = null;
    } catch (error: any) {
      const errorMsg = `Failed to load URDF "${label}": ${error.message || String(error)}`;
      console.error(errorMsg, error);
      this.errorMessage = errorMsg;
      throw error;
    }
  }

  async regeneratePointCloud(): Promise<void> {
    if (!this.wasmModule || !this.kinematicTree) return;
    this.manipulabilityRange = { min: Infinity, max: -Infinity };
    this.conditionNumberRange = { min: Infinity, max: -Infinity };
    this.orientationManipulabilityRange = { min: Infinity, max: -Infinity };
    this.orientationConditionNumberRange = { min: Infinity, max: -Infinity };
    await this.generateMonteCarloPointCloud();
  }

  private async generateMonteCarloPointCloud(): Promise<void> {
    if (!this.wasmModule || !this.kinematicTree) return;

    this.isGeneratingPointCloud = true;
    this.pointCloudProgress = 0;
    this.cancelGeneration = false;
    const points: MonteCarloPoint[] = [];

    // Small fixed batch size for smooth UI updates
    const batchSize = 10;

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

    // Rejection sampling: only generate points within plane bounds if filtering is enabled
    let planeBounds: { min: number, max: number } | null = null;
    if (this.enablePlaneFiltering && this.plane1 && this.plane2) {
      const plane1Z = this.plane1.position.z;
      const plane2Z = this.plane2.position.z;
      planeBounds = {
        min: Math.min(plane1Z, plane2Z),
        max: Math.max(plane1Z, plane2Z)
      };
    }

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
      const flatVec = this.wasmModule.fkFlat(this.kinematicTree, this.targetLink);
      const elements: number[] = [];
      for (let k = 0; k < 16; k++) elements.push(flatVec.get(k));
      flatVec.delete();

      const mat4 = new THREE.Matrix4().fromArray(elements);
      const position = new THREE.Vector3().setFromMatrixPosition(mat4);

      // Check if point is within plane bounds BEFORE expensive manipulability calculation
      if (planeBounds) {
        const posZ = position.z;
        if (posZ < planeBounds.min || posZ > planeBounds.max) {
          attempts++;
          continue; // Skip this point - outside bounds
        }
      }

      // Compute manipulability for points that passed the filter
      const manip = this.wasmModule.getManipulability(
        this.kinematicTree,
        this.targetLink,
        this.rootLink,
        jointNamesVec
      );

      const manipulability = manip.wPos;
      const orientationManipulability = manip.wOri;

      // Calculate reciprocal condition number from position singular values (higher is better, [0,1] range)
      const posValues = [];
      for (let k = 0; k < 3; k++) {
        posValues.push(manip.posValues.get(k));
      }
      const maxPosValue = Math.max(...posValues);
      const minPosValue = Math.min(...posValues);
      const conditionNumber = maxPosValue > 1e-10 ? minPosValue / maxPosValue : 0;  // Reciprocal: 0 (singular) to 1 (well-conditioned)

      // Calculate reciprocal condition number from orientation singular values
      const oriValues = [];
      for (let k = 0; k < 3; k++) {
        oriValues.push(manip.oriValues.get(k));
      }
      const maxOriValue = Math.max(...oriValues);
      const minOriValue = Math.min(...oriValues);
      const orientationConditionNumber = maxOriValue > 1e-10 ? minOriValue / maxOriValue : 0;

      // Clean up WASM vectors
      manip.posAxes.delete();
      manip.posValues.delete();
      manip.oriAxes.delete();
      manip.oriValues.delete();

      points.push({
        position,
        manipulability,
        conditionNumber,
        orientationManipulability,
        orientationConditionNumber,
        jointConfig: [...jointConfig]
      });
      successfulPoints++;
      attempts++;

      // Track range for color mapping
      this.manipulabilityRange.min = Math.min(this.manipulabilityRange.min, manipulability);
      this.manipulabilityRange.max = Math.max(this.manipulabilityRange.max, manipulability);

      // Track reciprocal condition number range [0, 1]
      this.conditionNumberRange.min = Math.min(this.conditionNumberRange.min, conditionNumber);
      this.conditionNumberRange.max = Math.max(this.conditionNumberRange.max, conditionNumber);

      // Track orientation ranges
      this.orientationManipulabilityRange.min = Math.min(this.orientationManipulabilityRange.min, orientationManipulability);
      this.orientationManipulabilityRange.max = Math.max(this.orientationManipulabilityRange.max, orientationManipulability);
      this.orientationConditionNumberRange.min = Math.min(this.orientationConditionNumberRange.min, orientationConditionNumber);
      this.orientationConditionNumberRange.max = Math.max(this.orientationConditionNumberRange.max, orientationConditionNumber);

      // Batch progress updates (yield to UI every batch)
      if (successfulPoints % batchSize === 0) {
        this.pointCloudProgress = (successfulPoints / this.pointCloudCount) * 100;
        // Use requestAnimationFrame for smoother UI updates
        await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
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
      // For reciprocal condition numbers, use 5th percentile as min to avoid extreme outliers near 0
      const sortedConditionNumbers = points
        .map(p => p.conditionNumber)
        .sort((a, b) => a - b);
      const sortedOrientationConditionNumbers = points
        .map(p => p.orientationConditionNumber)
        .sort((a, b) => a - b);

      if (sortedConditionNumbers.length > 0) {
        const p5Index = Math.floor(sortedConditionNumbers.length * 0.05);
        this.conditionNumberRange.min = sortedConditionNumbers[p5Index];
        this.orientationConditionNumberRange.min = sortedOrientationConditionNumbers[p5Index];
      }

      console.log('Position manipulability range:', this.manipulabilityRange);
      console.log('Position condition number range:', this.conditionNumberRange);
      console.log('Orientation manipulability range:', this.orientationManipulabilityRange);
      console.log('Orientation condition number range:', this.orientationConditionNumberRange);
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
