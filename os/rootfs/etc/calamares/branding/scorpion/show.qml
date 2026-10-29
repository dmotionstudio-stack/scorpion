/* Scorpion OS installer: what shows while it installs. The logo stays at the
   top and breathes, with a gold ring turning around it; the messages below
   change every nine seconds. */
import QtQuick 2.0;
import calamares.slideshow 1.0;

Presentation {
    id: presentation

    function onActivate() { }
    function onLeave() { }

    Timer {
        interval: 9000
        running: presentation.activatedInCalamares
        repeat: true
        onTriggered: presentation.goToNextSlide()
    }

    Rectangle { anchors.fill: parent; color: "#0e0d0b"; z: -1 }

    Item {
        id: mark
        width: 190; height: 190
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: parent.height * 0.12
        z: 1

        // A soft glow that swells with the logo.
        Rectangle {
            id: glow
            anchors.centerIn: parent
            width: 150; height: 150; radius: 75
            color: "#f5c518"
            opacity: 0.10
            SequentialAnimation on opacity {
                loops: Animation.Infinite
                NumberAnimation { to: 0.24; duration: 1400; easing.type: Easing.InOutSine }
                NumberAnimation { to: 0.10; duration: 1400; easing.type: Easing.InOutSine }
            }
            SequentialAnimation on scale {
                loops: Animation.Infinite
                NumberAnimation { to: 1.18; duration: 1400; easing.type: Easing.InOutSine }
                NumberAnimation { to: 1.0; duration: 1400; easing.type: Easing.InOutSine }
            }
        }

        // The turning ring: two gold arcs.
        Canvas {
            id: ring
            anchors.fill: parent
            onPaint: {
                var ctx = getContext("2d");
                ctx.reset();
                ctx.lineWidth = 3;
                ctx.lineCap = "round";
                ctx.strokeStyle = "#f5c518";
                var c = width / 2, r = width / 2 - 4;
                ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 0.55); ctx.stroke();
                ctx.globalAlpha = 0.45;
                ctx.beginPath(); ctx.arc(c, c, r, Math.PI, Math.PI * 1.35); ctx.stroke();
            }
            RotationAnimation on rotation { from: 0; to: 360; duration: 2600; loops: Animation.Infinite }
        }

        Image {
            source: "welcome.png"
            width: 128; height: 128
            anchors.centerIn: parent
            fillMode: Image.PreserveAspectFit
            smooth: true
            SequentialAnimation on scale {
                loops: Animation.Infinite
                NumberAnimation { to: 1.06; duration: 1400; easing.type: Easing.InOutSine }
                NumberAnimation { to: 1.0; duration: 1400; easing.type: Easing.InOutSine }
            }
        }
    }

    Slide {
        Text { anchors.horizontalCenter: parent.horizontalCenter; y: parent.height * 0.12 + 220; color: "#f2eee2"; font.pixelSize: 22; text: "Scorpion OS is being installed" }
    }
    Slide {
        Text { anchors.horizontalCenter: parent.horizontalCenter; y: parent.height * 0.12 + 220; width: parent.width * 0.7; wrapMode: Text.WordWrap; horizontalAlignment: Text.AlignHCenter; color: "#f2eee2"; font.pixelSize: 18
               text: "Your AI runs on this computer: models, voice, faces and hand gestures never leave it." }
    }
    Slide {
        Text { anchors.horizontalCenter: parent.horizontalCenter; y: parent.height * 0.12 + 220; width: parent.width * 0.7; wrapMode: Text.WordWrap; horizontalAlignment: Text.AlignHCenter; color: "#f2eee2"; font.pixelSize: 18
               text: "Installed alongside Windows? The boot menu lets you pick Scorpion OS or Windows each time the computer starts." }
    }
}
