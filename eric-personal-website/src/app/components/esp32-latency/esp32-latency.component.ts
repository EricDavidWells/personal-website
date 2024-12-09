import { Component, OnInit } from '@angular/core';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';


@Component({
  selector: 'app-esp32-latency',
  imports: [],
  templateUrl: './esp32-latency.component.html',
  styleUrl: './esp32-latency.component.css'
})
export class Esp32LatencyComponent implements OnInit{

  project: Project | undefined;

  ngOnInit(): void {
    this.project = PROJECTS.find(project => project.slug === 'esp32-latency');
  }

}
