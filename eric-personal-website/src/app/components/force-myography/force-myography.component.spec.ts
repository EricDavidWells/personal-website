import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ForceMyographyComponent } from './force-myography.component';

describe('ForceMyographyComponent', () => {
  let component: ForceMyographyComponent;
  let fixture: ComponentFixture<ForceMyographyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ForceMyographyComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ForceMyographyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
