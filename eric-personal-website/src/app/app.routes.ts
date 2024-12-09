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
];
