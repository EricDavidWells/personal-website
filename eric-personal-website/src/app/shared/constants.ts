import { Project } from './project';

export const PROJECTS: Project[] = 
[
  new Project(
      'blobs',
      'Blob Neuroevolution Simulation', 
      '2017-04',
      '/assets/images/blobs_icon.png',
      `Blob's battle for survival while evolving through genetic algorithms.`
  ),
  new Project('project-two', 'Project Two', '2023-02-15', 'path/to/image2.jpg', 'A brief description of Project Two.'),
]

