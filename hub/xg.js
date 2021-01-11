function getParam(url, tag) {
    if (url.indexOf(`${tag}=`) > -1) {
        return url.split(`${tag}=`)[1].split("&")[0];
    }
    return null;
}

class XGMain extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            isLoading: props.stadiums ? false : true,
        };
    }
    render() {
        const isLoading = this.state.isLoading;
        return (
            <div className={`MainContainer XG ${isLoading ? "Loading" : ""}`}>
                <div className="Loader">
                    <div class="lds"><div></div><div></div><div></div></div>
                </div>
                <section>
                    <h1>Expected Goals (XG)</h1>
                </section>
            </div>
        );
    }
}

function renderMain(matchID, stadiums) {
    const mainEl = document.getElementById("main");
    const mainRe = <XGMain stadiums={stadiums} />
    ReactDOM.unmountComponentAtNode(mainEl);
    ReactDOM.render(mainRe, mainEl);
}

const url = document.location.href;
const matchID = getParam(url, "m");
const useLocal = getParam(url, "l") === true;
console.log(matchID, useLocal);

renderMain(matchID, null);
loadStadiumData().then((stadiums) => {
    renderMain(matchID, stadiums);
}).catch((err) => {
    console.log("Error loading stadium data:");
    console.error(err);
});
