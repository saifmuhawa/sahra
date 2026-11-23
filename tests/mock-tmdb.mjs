// سيرفر TMDB وهمي للاختبار (بدون مفتاح حقيقي)
import http from "node:http";
const movie = {
  id: 27205, title: "Inception", original_title: "Inception", release_date: "2010-07-15", runtime: 148, genres: [{ id: 28 }, { id: 878 }],
  original_language: "en", popularity: 90, vote_average: 8.4, vote_count: 35000, poster_path: "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
  overview: "Cobb, a skilled thief who steals secrets from deep within the subconscious during the dream state, is offered a chance at redemption.",
  tagline: "Your mind is the scene of the crime.", budget: 160000000, revenue: 839030630, imdb_id: "tt1375666",
  production_companies: [{ name: "Legendary Pictures" }, { name: "Syncopy" }], production_countries: [{ iso_3166_1: "US" }, { iso_3166_1: "GB" }], spoken_languages: [{ english_name: "English" }],
  credits: { cast: ["Leonardo DiCaprio:Dom Cobb", "Joseph Gordon-Levitt:Arthur", "Elliot Page:Ariadne", "Tom Hardy:Eames", "Ken Watanabe:Saito"].map(s => ({ name: s.split(":")[0], character: s.split(":")[1] })),
    crew: [{ job: "Director", name: "Christopher Nolan" }, { job: "Screenplay", name: "Christopher Nolan" }, { job: "Original Music Composer", name: "Hans Zimmer" }] },
  translations: { translations: [{ iso_639_1: "ar", data: { title: "استهلال", overview: "" } }] }, external_ids: { imdb_id: "tt1375666" }, videos: { results: [] }, release_dates: { results: [{ iso_3166_1: "US", release_dates: [{ type: 3, release_date: "2010-07-16T00:00:00.000Z" }] }] },
};
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  res.setHeader("content-type", "application/json");
  if (u.pathname === "/3/movie/27205") return res.end(JSON.stringify(movie));
  if (u.pathname === "/3/search/movie") return res.end(JSON.stringify({ results: [{ id: 27205, title: "Inception", release_date: "2010-07-15", poster_path: movie.poster_path, genre_ids: [28, 878], vote_count: 35000 }] }));
  res.statusCode = 404; res.end("{}");
}).listen(8788, () => console.log("mock tmdb on 8788"));
