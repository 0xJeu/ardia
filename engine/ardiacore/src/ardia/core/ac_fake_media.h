#ifndef ARDIA_CORE_AC_FAKE_MEDIA_H_
#define ARDIA_CORE_AC_FAKE_MEDIA_H_

namespace content {
struct MediaStreamRequest;
}

namespace ardiacore {

bool UsingFakeMediaDevices();

void InstallFakeMediaDevices();

void KeepAudioCaptureFake(content::MediaStreamRequest& request);

}

#endif
