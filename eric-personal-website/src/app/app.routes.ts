import { Routes } from '@angular/router';

export const routes: Routes = [
    {
    path: '',
    pathMatch: 'full',
    loadComponent: () => {
        return import('./components/home/home.component').then((m) => m.HomeComponent)
    }
    },
    {
        path: 'projects/blobs',
        pathMatch: 'full',
        loadComponent: () => {
            return import('./components/blobs/blobs.component').then((m) => m.BlobsComponent)
        }
    },
    {
        path: 'projects/force-myography',
        pathMatch: 'full',
        loadComponent: () => {
            return import('./components/force-myography/force-myography.component').then((m) => m.ForceMyographyComponent)
        }
    },
    {
        path: 'projects/axis-reloaded',
        pathMatch: 'full',
        loadComponent: () => {
            return import('./components/axis-reloaded/axis-reloaded.component').then((m) => m.AxisReloadedComponent )
        }
    },
    {
        path: 'projects/polyvolve',
        pathMatch: 'full',
        loadComponent: () => {
            return import('./components/polyvolve/polyvolve.component').then((m) => m.PolyvolveComponent )
        }
    },
    {
        path: 'projects/compliant-sensors',
        pathMatch: 'full',
        loadComponent: () => {
            return import('./components/compliant-sensors/compliant-sensors.component').then((m) => m.CompliantSensorsComponent )
        }
    },
    {
        path: 'projects/esp32-latency',
        pathMatch: 'full',
        loadComponent: () => {
            return import('./components/esp32-latency/esp32-latency.component').then((m) => m.Esp32LatencyComponent )
        }
    },
    {
        path: 'projects/advent-of-code',
        pathMatch: 'full',
        loadComponent: () => {
            return import('./components/advent-of-code/advent-of-code.component').then((m) => m.AdventOfCodeComponent )
        }
    },
    {
        path: 'projects/multi-myo',
        pathMatch: 'full',
        loadComponent: () => {
            return import('./components/multi-myo/multi-myo.component').then((m) => m.MultiMyoComponent )
        }
    },
    {
        path: 'projects/humanoid-teleoperation',
        pathMatch: 'full',
        loadComponent: () => {
            return import('./components/humanoid-teleoperation/humanoid-teleoperation.component').then((m) => m.HumanoidTeleoperationComponent)
        }
    },
    {
        path: 'projects',
        pathMatch: 'full',
        loadComponent: () => {
            return import('./components/projects/projects.component').then((m) => m.ProjectsComponent)
        }
    },
    {
        path: 'projects/emg-pattern-rec',
        pathMatch: 'full',
        loadComponent: () => {
            return import('./components/emg-pattern-rec/emg-pattern-rec.component').then((m) => m.EmgPatternRecComponent)
        }
    },
];
