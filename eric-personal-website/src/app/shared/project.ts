// project.model.ts
export class Project {
  slug: string;
  title: string;
  date: string;
  icon_path: string;
  description: string;

  constructor(slug: string, title: string, date: string, icon_path: string, description: string) {
    this.slug = slug;
    this.title = title;
    this.date = date;
    this.icon_path = icon_path;
    this.description = description;
  }
}
