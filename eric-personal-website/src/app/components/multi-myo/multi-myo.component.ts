import { Component, OnInit } from '@angular/core';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';

@Component({
  selector: 'app-multi-myo',
  imports: [],
  templateUrl: './multi-myo.component.html',
  styleUrl: './multi-myo.component.css'
})

export class MultiMyoComponent implements OnInit{

  project: Project | undefined;

  ngOnInit(): void {
    this.project = PROJECTS.find(project => project.slug === 'multi-myo');
  }

}
