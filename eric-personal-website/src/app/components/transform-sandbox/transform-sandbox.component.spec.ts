import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TransformSandboxComponent } from './transform-sandbox.component';

describe('TransformSandboxComponent', () => {
  let component: TransformSandboxComponent;
  let fixture: ComponentFixture<TransformSandboxComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransformSandboxComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TransformSandboxComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
