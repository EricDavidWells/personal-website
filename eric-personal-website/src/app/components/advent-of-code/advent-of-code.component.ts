import { Component, OnInit } from '@angular/core';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';

@Component({
  selector: 'app-advent-of-code',
  imports: [],
  templateUrl: './advent-of-code.component.html',
  styleUrl: './advent-of-code.component.css'
})
export class AdventOfCodeComponent implements OnInit{

  project: Project | undefined;

  ngOnInit(): void {
    this.project = PROJECTS.find(project => project.slug === 'advent-of-code');
  }

}
