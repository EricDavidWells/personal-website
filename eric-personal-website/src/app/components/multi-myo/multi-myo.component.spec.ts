import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MultiMyoComponent } from './multi-myo.component';

describe('MultiMyoComponent', () => {
  let component: MultiMyoComponent;
  let fixture: ComponentFixture<MultiMyoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MultiMyoComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MultiMyoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
