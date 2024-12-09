import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PolyvolveComponent } from './polyvolve.component';

describe('PolyvolveComponent', () => {
  let component: PolyvolveComponent;
  let fixture: ComponentFixture<PolyvolveComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PolyvolveComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PolyvolveComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
