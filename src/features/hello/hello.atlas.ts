import { atlas, star } from "@kernel/index";

export const HelloAtlas = atlas("hello", {
  prefix: "/hello",
  stars: {
    greet: star.get("/"),
  },
});
