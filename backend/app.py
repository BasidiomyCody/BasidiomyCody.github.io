from flask import Flask


app = Flask(__name__, static_folder="../frontend", static_url_path="")


# ---------- Flask route ----------
@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/map")
def mycomap():
    return app.send_static_file("map.html")


@app.route("/art")
def portfolio():
    return app.send_static_file("art.html")


@app.route("/me")
def career():
    return app.send_static_file("about.html")


if __name__ == "__main__":
    app.run(debug=True, port=5000)
