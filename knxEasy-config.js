const knx = require('knx')
const dptlib = require('knx/src/dptlib')

//Helpers
sortBy = (field) => (a, b) => {
    if (a[field] > b[field]) { return 1 } else { return -1 }
}


onlyDptKeys = (kv) => {
    return kv[0].startsWith("DPT")
}

extractBaseNo = (kv) => {
    return {
        subtypes: kv[1].subtypes,
        base: parseInt(kv[1].id.replace("DPT", ""))
    }
}

convertSubtype = (baseType) => (kv) => {
    let value = `${baseType.base}.${kv[0]}`
    return {
        value: value
        , text: value + ` (${kv[1].name})`
    }
}


toConcattedSubtypes = (acc, baseType) => {
    let subtypes =
        Object.entries(baseType.subtypes)
            .sort(sortBy(0))
            .map(convertSubtype(baseType))

    return acc.concat(subtypes)
}


module.exports = (RED) => {
    RED.httpAdmin.get("/knxEasyDpts", RED.auth.needsPermission('knxEasy-config.read'), function (req, res) {
        const dpts =
            Object.entries(dptlib)
                .filter(onlyDptKeys)
                .map(extractBaseNo)
                .sort(sortBy("base"))
                .reduce(toConcattedSubtypes, [])

        res.json(dpts)
    });

    function knxEasyConfigNode(n) {
        RED.nodes.createNode(this, n)
        var node = this
        node.host = n.host
        node.port = n.port
        node.context().global.set("knxEasyDpts", dptlib.dpts)

        var knxErrorTimeout
        node.inputUsers = []
        node.outputUsers = []

        node.register = (userType, knxNode) => {
            userType == "in"
                ? node.inputUsers.push(knxNode)
                : node.outputUsers.push(knxNode)
            if (node.inputUsers.length + node.outputUsers.length === 1) {
                node.connect();
            }
        }

        node.deregister = (userType, knxNode) => {
            userType == "in"
                ? node.inputUsers = node.inputUsers.filter(x => x.id !== knxNode.id)
                : node.outputUsers = node.outputUsers.filter(x => x.id !== knxNode.id)
            if (node.inputUsers.length + node.outputUsers.length === 0) {
                node.knxConnection = null
            }
        }

        node.readInitialValues = () => {
            var readHistory = []
            let delay = 50
            node.inputUsers
                .filter(input => input.initialread)
                .forEach(input => {
                    if (readHistory.includes(input.topic)) return
                    setTimeout(input._events.input, delay)
                    delay = delay + 50
                    readHistory.push(input.topic)
                })
        }

        node.setStatusHelper = (fill, text) => {
            function nextStatus(input) {
                input.status({ fill: fill, shape: "dot", text: text })
            }
            node.inputUsers.map(nextStatus)
            node.outputUsers.map(nextStatus)
        }

        node.setStatus = (status) => {
            switch (status) {
                case "connected":
                    node.setStatusHelper("green", "node-red:common.status.connected")
                    break
                case "knxError":
                    node.setStatusHelper("yellow", "connected, but error on knx-bus")
                    break
                case "disconnected":
                    node.setStatusHelper("red", "node-red:common.status.disconnected")
                    break
                default:
            }
        }

        node.connect = () => {
            node.setStatus("disconnected")
            node.knxConnection = new knx.Connection({
                ipAddr: node.host,
                ipPort: node.port,
                handlers: {
                    connected: () => {
                        if (knxErrorTimeout == undefined) {
                            node.setStatus("connected")
                            node.readInitialValues()
                        }
                    },
                    error: (connstatus) => {
                        node.error(connstatus)
                        if (connstatus == "E_KNX_CONNECTION") {
                            node.setStatus("knxError")
                        } else {
                            node.setStatus("disconnected")
                        }
                    }
                }
            })
            node.knxConnection.on("event", function (evt, src, dest, rawValue) {
                if (evt == "GroupValue_Write" || evt == "GroupValue_Response" || evt == "GroupValue_Read") {
                    node.inputUsers
                        .filter(input => input.topic == dest)
                        .forEach(input => {
                            if (evt == "GroupValue_Read") {
                                // Notify only in case option 'Notify read requests' is enabled
                                if (input.notifyreadrequest == false) return
                                // In case of GroupValue_Read event no payload / value is available
                                let msg = buildInputMessage(src, dest, evt, null, input.dpt)
                                input.send(msg)
                            } else {
                                let msg = buildInputMessage(src, dest, evt, rawValue, input.dpt)
                                input.send(msg)
                            }
                        })
                }
            })
        }

        function buildInputMessage(src, dest, evt, value, inputDpt) {
            // Resolve DPT and convert value if available
            var dpt = dptlib.resolve(inputDpt)
            var jsValue = null
            if (dpt && value) {
                var jsValue = dptlib.fromBuffer(value, dpt)
            }

            // Build final input message object
            return {
                topic: dest
                , payload: jsValue
                , knx:
                {
                    event: evt
                    , dpt: inputDpt
                    , dptDetails: dpt
                    , source: src
                    , destination: dest
                    , rawValue: value
                }
            }
        }

        node.on("close", function () {
            node.setStatus("disconnected")
            node.knxConnection.Disconnect()
            node.knxConnection = null
        })
    }
    RED.nodes.registerType("knxEasy-config", knxEasyConfigNode);
}
