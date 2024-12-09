import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CompliantSensorsComponent } from './compliant-sensors.component';

describe('CompliantSensorsComponent', () => {
  let component: CompliantSensorsComponent;
  let fixture: ComponentFixture<CompliantSensorsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompliantSensorsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CompliantSensorsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
