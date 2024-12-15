import { Component, OnInit } from '@angular/core';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';

@Component({
  selector: 'app-humanoid-teleoperation',
  imports: [],
  templateUrl: './humanoid-teleoperation.component.html',
  styleUrl: './humanoid-teleoperation.component.css'
})
export class HumanoidTeleoperationComponent implements OnInit {

  project: Project | undefined;

  ngOnInit(): void {
    this.project = PROJECTS.find(project => project.slug === 'humanoid-teleoperation');
  }

}
