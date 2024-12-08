import { Routes } from '@angular/router';

export const routes: Routes = [
    {
    path: '',
    pathMatch: 'full',
    loadComponent: () => {
        return import('./home/home.component').then((m) => m.HomeComponent)
    }
    },
    {
        path: 'projects/blobs',
        pathMatch: 'full',
        loadComponent: () => {
            return import('./components/blobs/blobs.component').then((m) => m.BlobsComponent)
        }
    },
];
