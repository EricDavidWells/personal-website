import { Component, OnInit } from '@angular/core';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';

@Component({
  selector: 'app-compliant-sensors',
  imports: [],
  templateUrl: './compliant-sensors.component.html',
  styleUrl: './compliant-sensors.component.css'
})
export class CompliantSensorsComponent implements OnInit {

  project: Project | undefined;

  ngOnInit(): void {
    this.project = PROJECTS.find(project => project.slug === 'compliant-sensors');
  }

}
