import { Component, OnInit, signal } from '@angular/core';
import { Project } from '../../shared/project';
import { PROJECTS } from '../../shared/constants';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent implements OnInit {  

  projects: Project[] = [];
  slugKeys: string[] = [];

  ngOnInit(): void {
    this.projects = PROJECTS;
  }

}
