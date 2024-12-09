import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Esp32LatencyComponent } from './esp32-latency.component';

describe('Esp32LatencyComponent', () => {
  let component: Esp32LatencyComponent;
  let fixture: ComponentFixture<Esp32LatencyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Esp32LatencyComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Esp32LatencyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
