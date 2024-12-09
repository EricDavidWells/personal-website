import { Component, OnInit } from '@angular/core';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';

@Component({
  selector: 'app-polyvolve',
  imports: [],
  templateUrl: './polyvolve.component.html',
  styleUrl: './polyvolve.component.css'
})
export class PolyvolveComponent implements OnInit {

  project: Project | undefined;

  ngOnInit(): void {
    this.project = PROJECTS.find(project => project.slug === 'polyvolve');
  }

}
