import { Component, OnInit } from '@angular/core';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';

@Component({
  selector: 'app-emg-pattern-rec',
  imports: [],
  templateUrl: './emg-pattern-rec.component.html',
  styleUrl: './emg-pattern-rec.component.css'
})
export class EmgPatternRecComponent {

  project: Project | undefined;

  ngOnInit(): void {
    this.project = PROJECTS.find(project => project.slug === 'emg-pattern-rec');
  }


}
