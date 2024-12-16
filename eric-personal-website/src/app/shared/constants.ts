import { Project } from './project';

export const PROJECTS: Project[] = [
  new Project(
    'humanoid-teleoperation',
    'Humanoid Teleoperation',
    '2024-12',
    'assets/images/humanoid-teleoperation/humanoid-teleoperation-icon.png',
    `Teleoperating humanoid robots at Sanctuary AI.`
  ),
  new Project(
    'emg-pattern-rec',
    'EMG Pattern Recognition',
    '2021-12',
    'assets/images/emg-pattern-rec/emg-pattern-rec-icon.png',
    `Electro-myography based pattern recognition for upper limb prosthesis control.`
  ),
  new Project(
    'multi-myo',
    'Multi-Myosharp',
    '2021-02',
    'assets/images/multi-myosharp-icon.png',
    `An electro-myography wristband's data acquisition strategy is improved.`
  ),
  new Project(
    'advent-of-code',
    'Advent of Code',
    '2020-12',
    'assets/images/advent-of-code-icon.png',
    `Programming puzzles are completed to improve skills.`
  ),
  new Project(
    'esp32-latency',
    'ESP32 Latency Testing',
    '2020-08',
    'assets/images/esp32-latency-icon.png',
    `Latency and throughput are evaluated on an ESP32 microcontroller.`
  ),
  new Project(
    'compliant-sensors',
    'Compliant Fingertip Sensors',
    '2020-03',
    'assets/images/compliant-sensors-icon.png',
    `Capacitive force sensors are evaluated for prosthetics.`
  ),
  new Project(
    'polyvolve',
    'Polyvolve',
    '2020-01',
    'assets/images/polyvolve-icon.png',
    `A genetic algorithm draws pictures using transparent polygons.`
  ),
  new Project(
    'axis-reloaded',
    'Axis Reloaded',
    '2019-09',
    'assets/images/axis-reloaded-icon.png',
    `A 15-DOF robotic claw rotates a platform continuously with self-correction.`
  ),
  new Project(
    'force-myography',
    'Wireless Force Myography',
    '2019-05',
    'assets/images/force-myography-icon.png',
    `A wireless arm band measuring muscle deformation controls a prosthesis.`
  ),
  new Project(
    'blobs',
    'Blob Neuroevolution Simulation',
    '2017-04',
    'assets/images/blobs-icon.png',
    `Blob's battle for survival while evolving through genetic algorithms.`
  ),
];
