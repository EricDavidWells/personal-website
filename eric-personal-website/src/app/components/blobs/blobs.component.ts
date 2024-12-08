import { Component, OnInit } from '@angular/core';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';

@Component({
  selector: 'app-blobs',
  imports: [],
  templateUrl: './blobs.component.html',
  styleUrl: './blobs.component.css'
})
export class BlobsComponent implements OnInit {

    project: Project | undefined;

    ngOnInit(): void {
      this.project = PROJECTS.find(project => project.slug === 'blobs');
    }
}
