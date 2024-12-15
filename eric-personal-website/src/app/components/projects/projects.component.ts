import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';

@Component({
  selector: 'app-projects',
  imports: [CommonModule, RouterLink],
  templateUrl: './projects.component.html',
  styleUrl: './projects.component.css'
})
export class ProjectsComponent implements OnInit {

  projects: Project[] = [];
  slugKeys: string[] = [];

  ngOnInit(): void {
    this.projects = PROJECTS;
  }


}

