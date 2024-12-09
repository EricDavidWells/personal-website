import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AxisReloadedComponent } from './axis-reloaded.component';

describe('AxisReloadedComponent', () => {
  let component: AxisReloadedComponent;
  let fixture: ComponentFixture<AxisReloadedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AxisReloadedComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AxisReloadedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
