import { Component, OnInit, signal } from '@angular/core';

@Component({
  selector: 'app-home',
  imports: [],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent implements OnInit {  

  public slides: string [] = [
    './assets/images/mugshot_ds.png',
    './assets/images/personal/cenotes.jpg', 
    './assets/images/personal/EricClimbNordegg.png',
    './assets/images/personal/EricPointCloudArm.png',
    // './assets/images/personal/EricDive.png', 
    './assets/images/personal/eric-multipitch.png',
  ]
  i: number = 0;

  showSlide(slides: string [], i: number) {
      let slide = slides[i];
      return slide;
  }

  getPrev(slides: string [], i: number) {
      this.i = (this.i - 1 + slides.length) % slides.length;
      this.showSlide(slides, i)
  }

  getNext(slides: string [], i: number) {
    this.i = (this.i + 1) % slides.length;
    this.showSlide(slides, i)
  }

  ngOnInit() {
    this.i = 0;
  }

}
