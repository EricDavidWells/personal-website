import { Component, OnInit } from '@angular/core';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';
@Component({
  selector: 'app-axis-reloaded',
  imports: [],
  templateUrl: './axis-reloaded.component.html',
  styleUrl: './axis-reloaded.component.css'
})
export class AxisReloadedComponent implements OnInit {

  project: Project | undefined;

  ngOnInit(): void {
    this.project = PROJECTS.find(project => project.slug === 'axis-reloaded');
  }

}
