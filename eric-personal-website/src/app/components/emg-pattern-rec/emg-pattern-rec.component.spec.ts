import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EmgPatternRecComponent } from './emg-pattern-rec.component';

describe('EmgPatternRecComponent', () => {
  let component: EmgPatternRecComponent;
  let fixture: ComponentFixture<EmgPatternRecComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmgPatternRecComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EmgPatternRecComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
