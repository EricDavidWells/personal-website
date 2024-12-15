import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HumanoidTeleoperationComponent } from './humanoid-teleoperation.component';

describe('HumanoidTeleoperationComponent', () => {
  let component: HumanoidTeleoperationComponent;
  let fixture: ComponentFixture<HumanoidTeleoperationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HumanoidTeleoperationComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HumanoidTeleoperationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
