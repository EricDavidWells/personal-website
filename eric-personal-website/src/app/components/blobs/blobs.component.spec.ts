import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BlobsComponent } from './blobs.component';

describe('BlobsComponent', () => {
  let component: BlobsComponent;
  let fixture: ComponentFixture<BlobsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BlobsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BlobsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
