import { Component, OnInit } from '@angular/core';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';

@Component({
  selector: 'app-force-myography',
  imports: [],
  templateUrl: './force-myography.component.html',
  styleUrl: './force-myography.component.css'
})
export class ForceMyographyComponent implements OnInit {

  project: Project | undefined;

  ngOnInit(): void {
    this.project = PROJECTS.find(project => project.slug === 'force-myography');
  }

}
